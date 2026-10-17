#!/bin/sh
# Restores a backup onto an EMPTY stack (Postgres and SeaweedFS up, the api not started):
#   docker compose run --rm -v /path/to/age-identity.txt:/run/secrets/backup_age_identity:ro backup restore.sh [latest|db-….dump.age] [--i-know]
# Refuses a database that already has tables unless --i-know. Prints the elapsed time (the RTO measurement).
. /usr/local/lib/backup/common.sh
configure
started=$(date +%s)

want=latest; force=0
for arg in "$@"; do
  case "$arg" in
    --i-know) force=1 ;;
    *) want=$arg ;;
  esac
done
[ -r /run/secrets/backup_age_identity ] || die "mount the age private key at /run/secrets/backup_age_identity (read-only)"

if [ "$want" = latest ]; then
  want=$(rclone lsf --files-only "$BACKUP_TARGET/db" | sort | tail -n 1)
  [ -n "$want" ] || die "no database backup found in $BACKUP_TARGET/db"
fi
log "restoring $want"

tables=$(psql -tA -c "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$tables" != 0 ] && [ "$force" != 1 ]; then
  die "the database already has $tables table(s): refusing to restore over live data (pass --i-know to overwrite)"
fi

work=$(mktemp -d); chmod 700 "$work"; trap 'rm -rf "$work"' EXIT
rclone copyto "$BACKUP_TARGET/db/$want" "$work/dump.age"
age -d -i /run/secrets/backup_age_identity "$work/dump.age" > "$work/dump"
if [ "$force" = 1 ]; then clean="--clean --if-exists"; else clean=""; fi
# shellcheck disable=SC2086
pg_restore --no-owner --no-privileges --single-transaction --exit-on-error $clean -d "$PGDATABASE" "$work/dump"
log "database restored"

log "restoring the photos"
rclone copy CRYPT: "SRC:$S3_BUCKET" --fast-list --transfers 4 --stats-one-line --log-level NOTICE
log "photos restored"

elapsed=$(( $(date +%s) - started ))
log "restore finished in ${elapsed}s — start the api now (docker compose up -d --wait); migrations run first"
