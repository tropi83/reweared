#!/bin/sh
# Deploys a released version on the host (run by the deploy user, over SSH or by hand):
#   deploy/deploy.sh 0.2.0
# 1. refuses to start unless .env and ./secrets are complete and private,
# 2. takes a backup first and waits for it (skipped on the very first deploy),
# 3. pulls the images, starts the stack (migrations run first, in the `migrate` service) and waits until healthy,
# 4. checks the live origin (readiness, the web page, an unauthenticated API call answering 401),
# 5. on any failure goes back to the previous version and mails the owner (the database is NOT restored: migrations are
#    expand/contract, so the previous image still reads it — see OPERATIONS.md → Deploy and roll back).
# Test knobs: AIV_DIR (checkout, default /srv/aiv), ENV_FILE, DEPLOY_ORIGIN, SKIP_PULL=1, SKIP_BACKUP=1, SKIP_PERMISSION_CHECK=1.
set -eu
cd "${AIV_DIR:-/srv/aiv}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

version=${1:-}
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$' || die "usage: deploy.sh <version>, e.g. 0.2.0"

# --- 1. refuse an incomplete or careless setup
env_file=${ENV_FILE:-.env}
[ -f "$env_file" ] || die "$env_file is missing"
for key in PUBLIC_ORIGIN MAIL_FROM CADDY_SITE; do
  grep -Eq "^$key=.+" "$env_file" || die "$key is not set in $env_file"
done
for file in $(grep -o 'file: \./secrets/[A-Za-z0-9_]*' compose.yaml | sed 's/^file: //'); do
  [ -s "$file" ] || die "secret file $file is missing or empty"
done
if [ "${SKIP_PERMISSION_CHECK:-}" != 1 ]; then
  [ "$(stat -c %a secrets)" = 700 ] || die "./secrets must be mode 700 (chmod 700 secrets)"
fi
origin=${DEPLOY_ORIGIN:-$(sed -n 's/^PUBLIC_ORIGIN=//p' "$env_file" | tail -n 1)}
previous=$(cat .aiv-version 2>/dev/null || true)

check() { # check <origin>: readiness, web page, unauthenticated API call
  i=0
  until [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1/api/v1/ready")" = 200 ]; do
    i=$((i + 1)); [ "$i" -lt 30 ] || { log "readiness did not become 200"; return 1; }
    sleep 4
  done
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1/")" = 200 ] || { log "the web page does not answer 200"; return 1; }
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1/api/v1/me")" = 401 ] || { log "GET /api/v1/me did not answer 401"; return 1; }
}

start() { # start <version>
  AIV_VERSION=$1 docker compose up -d --wait --wait-timeout 300
}

rollback() {
  if [ -z "$previous" ]; then log "no previous version to go back to"; return 1; fi
  log "rolling back to $previous"
  start "$previous" || return 1
  check "$origin" || return 1
  echo "$previous" > .aiv-version
}

notify() { # notify <text>: one mail to ALERT_EMAIL through the api
  printf '{"deployFailed":"%s"}' "$1" | AIV_VERSION=${previous:-$version} docker compose exec -T api node dist/watch.js >/dev/null 2>&1 || log "warning: the alert could not be sent"
}

# --- 2. backup first
if [ -n "$previous" ] && [ "${SKIP_BACKUP:-}" != 1 ]; then
  log "backing up before the change"
  AIV_VERSION=$previous docker compose --profile backup run --rm backup || die "the backup failed: nothing was changed"
fi

# --- 3. pull and start
export AIV_VERSION=$version
if [ "${SKIP_PULL:-}" != 1 ]; then
  log "pulling $version"
  docker compose pull || die "could not pull $version: nothing was changed"
  docker compose --profile backup pull backup || log "warning: could not pull the backup image"
fi
log "starting $version"
if start "$version" && check "$origin"; then
  echo "$version" > .aiv-version
  log "deployed $version (was ${previous:-nothing})"
  exit 0
fi

# --- 5. failure
log "deploying $version FAILED"
if rollback; then
  notify "version $version failed its checks and was rolled back to $previous"
  die "rolled back to $previous"
fi
notify "version $version failed its checks and the rollback failed too: the site is down"
die "the rollback failed: intervene (OPERATIONS.md → Deploy and roll back)"
