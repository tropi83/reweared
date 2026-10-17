#!/usr/bin/env bash
# Deploy → upgrade → failed upgrade → rollback, on this machine with the production compose file and locally tagged
# images (no registry): proves deploy.sh starts a version, replaces it with the next one, and returns to the previous
# version when the new one fails its checks. The server refuses the Mock provider in production, so the real providers are configured with placeholder keys
# (nothing is generated here). Needs Docker, free ports 80 and 443, and the dev secrets.
# Usage: scripts/deploy-drill.sh   (leaves nothing running; writes ./secrets/drill.env and ./.aiv-version-drill)
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1 COMPOSE_PROJECT_NAME=aivdrill
DEV=(docker compose --env-file deploy/dev.env -f compose.yaml -f compose.dev.yaml)
envfile=secrets/drill.env
cleanup() {
  rc=$?
  if [ $rc -ne 0 ]; then docker compose --env-file "$envfile" ps -a || true; docker compose --env-file "$envfile" logs --no-color --tail 25 api worker migrate || true; fi
  docker compose --env-file "$envfile" down -v >/dev/null 2>&1 || true
  rm -f "$envfile" .aiv-version
}
trap cleanup EXIT

node scripts/dev-secrets.mjs >/dev/null
cat > "$envfile" <<ENV
PUBLIC_ORIGIN=http://localhost
MAIL_FROM=AI Image Variations <no-reply@localhost>
CADDY_SITE=:80
MAIL_MODE=memory
CLOUDFLARE_ACCOUNT_ID=00000000000000000000000000000000
ENV
echo "== build the images once and tag them as releases"
"${DEV[@]}" build migrate caddy >/dev/null
for v in 1.0.0 1.0.1; do
  docker tag aiv-server:local "ghcr.io/tropi83/aiv-server:$v"
  docker tag aiv-web:local "ghcr.io/tropi83/aiv-web:$v"
done
# 1.0.2: a release whose containers die at once.
printf 'FROM aiv-server:local\nCMD ["node", "-e", "process.exit(1)"]\n' | docker build -q -t ghcr.io/tropi83/aiv-server:1.0.2 - >/dev/null
docker tag aiv-web:local ghcr.io/tropi83/aiv-web:1.0.2

export ENV_FILE="$envfile" COMPOSE_ENV_FILES="$envfile" AIV_DIR="$PWD" SKIP_PULL=1 SKIP_BACKUP=1 SKIP_PERMISSION_CHECK=1 DEPLOY_ORIGIN=http://localhost
rm -f .aiv-version
echo "== deploy 1.0.0 (first deploy)";  sh deploy/deploy.sh 1.0.0
[ "$(cat .aiv-version)" = 1.0.0 ]
echo "== upgrade to 1.0.1";             sh deploy/deploy.sh 1.0.1
[ "$(cat .aiv-version)" = 1.0.1 ]
echo "== upgrade to 1.0.2 must fail and roll back to 1.0.1"
if sh deploy/deploy.sh 1.0.2; then echo "the broken release was accepted"; exit 1; fi
[ "$(cat .aiv-version)" = 1.0.1 ]
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost/api/v1/ready)" = 200 ]
docker compose --env-file "$envfile" ps --format '{{.Image}}' | grep -q 'aiv-server:1.0.1'
echo "deploy drill passed"
