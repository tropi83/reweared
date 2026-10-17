#!/bin/sh
# Nightly backup: the database (pg_dump → age → off-site) and the photos (rclone crypt → off-site), then retention,
# then the "done" ping — only when both parts succeeded. DRY_RUN=1 prints what would happen and touches nothing.
. /usr/local/lib/backup/common.sh
configure
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required (the public key; the private one stays offline)}"

work=$(mktemp -d); chmod 700 "$work"
trap 'rc=$?; rm -rf "$work"; [ $rc -eq 0 ] || { log "backup FAILED (exit $rc)"; ping_monitor /fail; }' EXIT
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="db-$stamp.dump.age"

if [ "${DRY_RUN:-}" = 1 ]; then
  log "dry run: would dump $PGDATABASE@$PGHOST to $BACKUP_TARGET/db/$name, sync $S3_BUCKET to $BACKUP_TARGET/images (encrypted), apply retention, ping"
  exit 0
fi

log "dumping the database"
pg_dump --format=custom --no-owner --no-privileges | age -r "$BACKUP_AGE_RECIPIENT" > "$work/$name"
[ -s "$work/$name" ] || die "the encrypted dump is empty"
rclone copyto "$work/$name" "$BACKUP_TARGET/db/$name"
rclone cat "$BACKUP_TARGET/db/$name" | cmp -s - "$work/$name" || die "the uploaded dump differs from the local one"
log "database backup stored as $name ($(wc -c < "$work/$name") bytes)"

log "syncing the photos"
rclone sync "SRC:$S3_BUCKET" CRYPT: --fast-list --transfers 4 --stats-one-line --log-level NOTICE
log "photos synced"

log "applying retention"
rclone lsf --files-only "$BACKUP_TARGET/db" | node /usr/local/lib/backup/retention.mjs | while read -r old; do
  [ -n "$old" ] || continue
  log "deleting $old"
  rclone deletefile "$BACKUP_TARGET/db/$old"
done

ping_monitor
log "backup done"
