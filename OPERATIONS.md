# Operations

How the account version runs on one VPS, and what to do when something is wrong. Written for the owner and whoever replaces them. Backend design: [spec §7, §10](docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md); plan: [phase 4](docs/superpowers/plans/2026-10-12-backend-phase-4.md). Sections marked _to come_ are written by the phase 4 task named next to them.

**Rules that never bend:** nothing secret in git, logs or images; nothing destructive on the server (restore over live data, key rotation, deleting volumes) without the owner; a backup is only real once a restore has been rehearsed.

## Contents

1. Host from zero — _to come (task 3)_
2. [Configuration and secrets](#2-configuration-and-secrets)
3. [Backups and restore](#3-backups-and-restore)
4. Monitoring and alerts — _to come (task 5)_
5. Deploy and roll back — _to come (task 6)_
6. Incidents — _to come (task 5)_
7. Launch checklist and restore drill — _to come (task 10)_

## 2. Configuration and secrets

Public settings live in `.env` next to `compose.yaml` (see `.env.example`); secrets are files in `./secrets` (directory mode 700, owned by the deploy user), read by the containers as Docker secrets. `AIV_VERSION` names the released version to run.

Backup-related settings (all in `.env`; the credentials are secret files):

| Setting                                                                    | Meaning                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `BACKUP_TARGET`                                                            | rclone remote and path of the off-site storage, e.g. `offsite:aiv-backups`                                      |
| `RCLONE_CONFIG_OFFSITE_TYPE` / `_PROVIDER` / `_ENDPOINT` / `_REGION`       | describe that remote (default type `s3`, provider `Other`); another provider than the VPS's, EU, versioning on  |
| `secrets/backup_offsite_access_key_id`, `backup_offsite_secret_access_key` | its credentials                                                                                                 |
| `BACKUP_AGE_RECIPIENT`                                                     | the **public** age key the database dump is encrypted to                                                        |
| `secrets/backup_crypt_password`                                            | password of the `rclone crypt` layer that encrypts the photos (names and contents)                              |
| `BACKUP_PING_URL`                                                          | optional dead-man's switch URL; receives `…` on success and `…/fail` on failure — nothing else, never user data |

## 3. Backups and restore

**What is backed up.** Postgres (accounts, listings, credits, ledger, jobs) and the photo bucket. **Redis is not**: queued work and live events are rebuilt — jobs and credits live in Postgres and the reconciler re-offers whatever BullMQ lost.

**How.** A host timer runs the `backup` service every night (compose profile `backup`, image `aiv-backup`): `pg_dump --format=custom` → encrypted with `age` to `BACKUP_AGE_RECIPIENT` → uploaded and compared byte for byte; the bucket is synced through `rclone crypt` to `BACKUP_TARGET/images`. Retention of the dumps: the newest of each of the last 7 days, 4 weeks and 6 months (`scripts/backup/retention.mjs`); the photo copy mirrors the bucket, so the off-site bucket must keep **versions** (or object lock) to survive a mistaken deletion. The "done" ping is sent only after both parts succeeded; a failure sends `…/fail`.

```bash
# the timer's command (deploy/systemd/aiv-backup.service)
docker compose --profile backup run --rm backup
# preview without touching anything
docker compose --profile backup run --rm -e DRY_RUN=1 backup
```

**Keys.** Generate the age key pair once, on a machine you trust, with `age-keygen` (or `docker compose --profile backup run --rm --no-deps -T backup age-keygen`), put only the public key in `.env`, and store the **private key offline** (password manager + paper). Without it a backup cannot be read; with it on the server an intruder could read the backups. The `rclone crypt` password is on the server (the photos are not the most sensitive data and the sync must run unattended): losing the server and its secrets files means losing it too — keep a copy next to the age key.

**Targets.** RPO = 24 h (one night of data can be lost). RTO target = 2 h from a fresh machine with the secrets at hand — to be confirmed by the restore drill (task 10), whose measured time is written in the plan's Progress.

**Restore** — onto an **empty** stack only:

```bash
docker compose up -d --wait postgres redis seaweedfs        # not the api: migrations must not run first
docker compose --profile backup run --rm \
  -v /secure/path/age-identity.txt:/run/secrets/backup_age_identity:ro \
  backup restore.sh latest                                  # or a name from `rclone lsf $BACKUP_TARGET/db`
docker compose up -d --wait                                 # migrate runs, then the api, worker and Caddy
```

`restore.sh` refuses a database that already has tables (`--i-know` overwrites it: only for a deliberate rollback, after the owner says so), prints the elapsed seconds and tells you the next step. After a restore, sessions created after the backup are gone (users sign in again) and credits/jobs are as of the backup.

**Proof.** `scripts/backup-roundtrip.sh` (run by CI on every push) creates an account with a listing, photos and a generation, backs up to a local directory, deletes the database, queue and photo volumes, restores, and checks through the API that the listing and its photos are back — and that a second restore refuses to overwrite live data.
