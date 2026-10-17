#!/usr/bin/env bash
# Backup → wipe → restore drill on the dev stack (CI and local): proves a backup can bring a listing and its photos
# back. Creates a throwaway account through the API, backs up to a local "off-site" volume with a fresh age key,
# deletes the database, queue and photo volumes, restores onto the empty stack, and checks the data through the API.
# Usage: scripts/backup-roundtrip.sh   (needs Docker and Node; leaves the stack stopped and the secrets in ./secrets)
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1 COMPOSE_PROJECT_NAME=aivroundtrip
C=(docker compose --env-file deploy/dev.env -f compose.yaml -f compose.dev.yaml)
state=secrets/roundtrip_state.json # kept inside the repo: node on Windows does not see Git Bash's /tmp
identity=secrets/roundtrip_age_identity.txt
cleanup() { rm -f "$state" "$identity"; "${C[@]}" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

node scripts/dev-secrets.mjs >/dev/null
"${C[@]}" down -v >/dev/null 2>&1 || true
echo "== start the stack and create data"
"${C[@]}" up -d --build --wait --wait-timeout 300
SMOKE_KEEP_STATE="$state" node scripts/server-smoke.mjs

echo "== back up (fresh age key; the private key stays in $identity)"
"${C[@]}" --profile backup run --rm --no-deps -T backup age-keygen > "$identity" 2>/dev/null
recipient=$(sed -n 's/^# public key: //p' "$identity")
[ -n "$recipient" ] || { echo "no age public key"; exit 1; }
BACKUP_AGE_RECIPIENT="$recipient" "${C[@]}" --profile backup run --rm -T backup backup.sh
chmod 644 "$identity"

echo "== wipe the database, the queue and the photos (the off-site volume stays)"
"${C[@]}" down
for v in postgres-data redis-data seaweedfs-data; do docker volume rm "${COMPOSE_PROJECT_NAME}_$v" >/dev/null; done

echo "== restore onto the empty stack"
"${C[@]}" up -d --wait --wait-timeout 300 postgres redis seaweedfs
"${C[@]}" --profile backup run --rm -T -v "$PWD/$identity:/run/secrets/backup_age_identity:ro" backup restore.sh
"${C[@]}" up -d --wait --wait-timeout 300

echo "== a second restore must refuse to overwrite live data"
if "${C[@]}" --profile backup run --rm -T -v "$PWD/$identity:/run/secrets/backup_age_identity:ro" backup restore.sh; then
  echo "restore.sh overwrote a live database without --i-know"; exit 1
fi

echo "== verify through the API"
SMOKE_VERIFY_STATE="$state" node scripts/server-smoke.mjs
echo "backup round trip passed"
