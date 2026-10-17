#!/bin/sh
# Host watch, run every 5 minutes by aiv-watch.timer: gathers what only the host can see (disk, restarting containers,
# local readiness, the nightly credit check's log line), hands it to the api image (`node dist/watch.js`), which adds
# jobs and worker liveness, applies the thresholds and mails ALERT_EMAIL once per alert per 6 hours.
# Nothing personal is read or sent. DRY_RUN=1 prints the facts instead of calling the api.
set -eu
cd "${AIV_DIR:-/srv/aiv}"

RESTART_LIMIT="${RESTART_LIMIT:-3}"
DATA_DIR="${DATA_DIR:-/var/lib/docker}"

disk=$(df -P "$DATA_DIR" | awk 'NR==2 { gsub("%", "", $5); print $5 }')

restarting=""
for id in $(docker compose ps -q 2>/dev/null); do
  count=$(docker inspect -f '{{.RestartCount}}' "$id")
  if [ "$count" -gt "$RESTART_LIMIT" ]; then
    name=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")
    restarting="$restarting\"$name\","
  fi
done
restarting="[${restarting%,}]"

ready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${READY_URL:-http://127.0.0.1/api/v1/ready}" || true)
[ -n "$ready" ] && [ "$ready" != 000 ] || ready=0

if docker compose logs --since 24h --no-color worker api 2>/dev/null | grep -q 'credit balances differ from their ledger'; then drift=true; else drift=false; fi

facts=$(printf '{"diskPercent":%s,"restartingContainers":%s,"readyStatus":%s,"creditDriftLogged":%s}' "$disk" "$restarting" "$ready" "$drift")

if [ "${DRY_RUN:-}" = 1 ]; then
  echo "$facts"
  exit 0
fi

echo "$facts" | docker compose exec -T api node dist/watch.js || logger -t aiv-watch "watch could not reach the api"
