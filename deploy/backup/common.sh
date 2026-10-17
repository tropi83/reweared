#!/bin/sh
# Shared by backup.sh and restore.sh. Never `set -x` here: secrets pass through the environment.
set -eu

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# Every VAR_FILE whose VAR is one of ours becomes VAR (the contents of the secret file), the way the server does.
load_secret_files() {
  for name in $(env | sed -n 's/^\(RCLONE_CONFIG_[A-Z0-9_]*\)_FILE=.*/\1/p'); do
    file=$(printenv "${name}_FILE")
    [ -r "$file" ] || die "secret file for $name is not readable"
    export "$name=$(cat "$file")"
  done
}

read_secret() { [ -r "/run/secrets/$1" ] || die "secret $1 is missing"; tr -d '\n' < "/run/secrets/$1"; }

# Pieces shared by both directions. SRC = the image store (SeaweedFS), CRYPT = the off-site copy of it, encrypted.
configure() {
  : "${BACKUP_TARGET:?BACKUP_TARGET is required, e.g. offsite:aiv-backups (an rclone remote and path)}"
  load_secret_files
  export PGHOST="${PGHOST:-postgres}" PGUSER="${PGUSER:-aiv}" PGDATABASE="${PGDATABASE:-aiv}"
  PGPASSWORD=$(read_secret postgres_password); export PGPASSWORD
  S3_BUCKET="${S3_BUCKET:-aiv-images}"
  export RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER=Other RCLONE_CONFIG_SRC_ENDPOINT="${S3_ENDPOINT:-http://seaweedfs:8333}"
  export RCLONE_CONFIG_SRC_REGION="${S3_REGION:-us-east-1}"
  RCLONE_CONFIG_SRC_ACCESS_KEY_ID=$(read_secret s3_access_key_id); export RCLONE_CONFIG_SRC_ACCESS_KEY_ID
  RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY=$(read_secret s3_secret_access_key); export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY
  # File names and contents of the photos are encrypted before they leave the host (rclone crypt).
  export RCLONE_CONFIG_CRYPT_TYPE=crypt RCLONE_CONFIG_CRYPT_REMOTE="${BACKUP_TARGET}/images"
  RCLONE_CONFIG_CRYPT_PASSWORD=$(rclone obscure "$(read_secret backup_crypt_password)"); export RCLONE_CONFIG_CRYPT_PASSWORD
}

ping_monitor() { # ping_monitor [suffix]: a dead-man's switch receives "done" (or "fail"); nothing else, ever
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  wget -q -T 10 -O /dev/null "${BACKUP_PING_URL}${1:-}" || log "warning: the monitoring ping failed"
}
