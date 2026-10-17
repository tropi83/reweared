# Operations

How the account version runs on one VPS, and what to do when something is wrong. Written for the owner and whoever replaces them. Backend design: [spec §7, §10](docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md); plan: [phase 4](docs/superpowers/plans/2026-10-12-backend-phase-4.md). Sections marked _to come_ are written by the phase 4 task named next to them.

**Rules that never bend:** nothing secret in git, logs or images; nothing destructive on the server (restore over live data, key rotation, deleting volumes) without the owner; a backup is only real once a restore has been rehearsed.

## Contents

1. Host from zero — _to come (task 3)_
2. [Configuration and secrets](#2-configuration-and-secrets)
3. [Backups and restore](#3-backups-and-restore)
4. [Monitoring and alerts](#4-monitoring-and-alerts)
5. [Deploy and roll back](#5-deploy-and-roll-back)
6. [Incidents](#6-incidents)
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

## 4. Monitoring and alerts

Nothing here receives user data, emails, prompts or images.

- **Outside uptime check** (healthchecks.io or a self-hosted Uptime Kuma on another machine — decision D4): `GET https://<domain>/api/v1/ready` every minute, alert after 3 failures. `ready` answers **503** and names what fails (`database`, `redis`, `storage`, `worker`), so a dead worker is caught from outside. Also watch the TLS certificate's expiry (Caddy renews it; the check alerts if it does not).
- **Backup dead-man's switch**: the backup pings `BACKUP_PING_URL` only after both parts succeed (and `…/fail` on failure); the service alerts when the ping is missing for 26 hours.
- **Host watch** (`deploy/watch.sh`, `deploy/systemd/aiv-watch.timer`, every 5 minutes): disk > 80 %, a container restarted more than 3 times, `ready` failing locally, no worker heartbeat, more than 10 failed jobs in an hour, more than 200 jobs waiting, the nightly credit check logging a difference. Each problem is mailed to `ALERT_EMAIL` once per 6 hours per problem, through the api's mailer; a message names the problem, never a user. If the api itself is down, the outside check is what alerts.
- **Counters for the owner**: `docker compose exec api node dist/stats.js` prints queue depth, jobs by status (24 h), failed jobs (1 h), verified sign-ups per day (7 days), credits granted / spent / refunded (7 days) and the number of live workers. There is no admin web page at launch.
- **Install the timers** (as root, once; paths assume the checkout is `/srv/aiv`): copy `deploy/systemd/aiv-*.{service,timer}` to `/etc/systemd/system/`, then `systemctl enable --now aiv-backup.timer aiv-watch.timer`.
- CI proves the watch: it forces one alert, checks the mail arrives once and that the second run is rate-limited.

## 5. Deploy and roll back

```bash
cd /srv/aiv && deploy/deploy.sh 0.2.0        # as the deploy user; the version is a tag already published by CI
```

The script refuses to start unless `.env` has `PUBLIC_ORIGIN`, `MAIL_FROM` and `CADDY_SITE`, every secret file exists and `./secrets` is mode 700. Then: a **backup** (and it waits for it; skipped on the very first deploy), `docker compose pull`, `up -d --wait` (the `migrate` service runs first), and a check of the **live origin** — `/api/v1/ready` is 200, the web page is 200, an unauthenticated `/api/v1/me` is 401. The deployed version is written to `.aiv-version`.

**If any step after the pull fails**, the script goes back to the version in `.aiv-version`, checks it again and mails the owner (`ALERT_EMAIL`). The database is **not** restored: every migration is _expand/contract_ — a release never drops or renames what the previous release still reads — so the previous image works on the new schema. A migration that cannot be undone that way must say so in its pull request and comes with a restore plan; deploying it is then a decision of the owner, with a fresh backup.

**Manual rollback**: `deploy/deploy.sh <previous version>` (it takes a backup first like any deploy; set `SKIP_BACKUP=1` only in an emergency). To deploy from CI later (decision D5), use a GitHub environment with a required approval and an SSH key restricted to `deploy/deploy.sh`; not set up at launch.

CI rehearses it on every push (`scripts/deploy-drill.sh`): deploy 1.0.0, upgrade to 1.0.1, try a release whose containers die, and check the site is back on 1.0.1.

## 6. Incidents

Logs are `docker compose logs --no-color <service>` (rotated: 5 × 10 MB per service). Every API log line carries a request id (`reqId`) and jobs carry `jobId`; user ids appear, emails, prompts, images, tokens and links never do.

```bash
docker compose ps                                          # who is up, healthy, restarting
docker compose logs --since 30m --no-color api | grep reqId_you_have
docker compose logs --since 1h --no-color worker | grep job_you_have
curl -s localhost/api/v1/ready                             # 503 names the failing dependency
docker compose exec api node dist/stats.js                 # queue depth, failures, sign-ups, credits
```

| Symptom                                         | First look                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ready` 503 `worker`                            | `docker compose logs worker`: Redis unreachable? crash loop? `docker compose restart worker`. Queued jobs are not lost; the reconciler re-offers them. |
| Jobs failing in bulk                            | Provider outage or budget: worker logs (error codes only), Cloudflare/Google status pages; the nightly neuron budget pauses image jobs by design.      |
| Credit check mail (balances differ from ledger) | Do **not** correct by hand. Find the user's ledger rows (`credit_ledger`), compare with `credit_balance`; an `adjust` entry is the only way to fix.    |
| Disk > 80 %                                     | `docker system df`; photos live in the `seaweedfs-data` volume — grow the disk before deleting anything.                                               |
| A user deleted by mistake                       | Restore from backup onto a **separate** machine, export the user's rows and photos; never restore over the live database.                              |
