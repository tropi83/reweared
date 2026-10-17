# Backend phase 4 — production — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Resuming?** Read the "Progress" section at the bottom first. Read the `backend`, `security-review`, `release` and `git-workflow` skills before any task.

**Goal:** The account version runs on one VPS for real users: images built and published by CI, a repeatable deployment with a backup before every change, nightly encrypted off-site backups whose restore has been rehearsed, monitoring that alerts a human, a security pass on the live host, and the privacy page users can rely on. Exit criterion (spec §10): **a restore drill done** — the production data restored from the off-site backup onto a fresh machine, the app working on it, the time it took written down.

**Architecture:** Nothing new in the application's shape. `compose.yaml` stays the production file; images come from GHCR instead of local builds; a `backup` one-shot service and host timers run the nightly jobs; operations live in `deploy/` (scripts) and a new `OPERATIONS.md` (runbooks). Monitoring is a dead-man's switch and an outside uptime check — nothing that receives user data.

**Spec:** `docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md` §7 (security, backups) and §10–11; the phase 2 and 3 plans' Progress (facts about the stack).

## Global Constraints

- Branch `feat/backend-phase-4` from `feat/backend-phase-3`. Conventional Commits; scopes `docker`, `ci`, `ops`, `api`, `worker`, `db`, `docs`; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nothing irreversible on a server without the owner.** Provisioning, DNS, paid accounts, the first production deploy and every destructive operation (restore over live data, key rotation) are done or approved by the owner; tasks prepare scripts and runbooks and test them on a throwaway VM or the local stack first.
- **Secrets never in git, CI logs or images**: Docker secrets as files on the host (`./secrets`, mode 600, owned by the deploy user); CI holds only the registry token and, if chosen, an SSH deploy key. Backups are encrypted before they leave the host (`age`, the private key kept offline by the owner).
- **No third-party analytics or telemetry** (CLAUDE.md). An outside check may call `/api/v1/ready`; a dead-man's switch may receive "backup done" pings; neither ever receives user data, emails, prompts or images.
- Forward-only migrations (drizzle). From now on every migration is **expand/contract**: a release never drops or renames what the previous release still reads, so an image rollback without a database restore stays possible.
- Everything testable is tested in CI (scripts with `--dry-run`, compose config checks, a backup → restore round trip against the CI stack). `pnpm check`, `pnpm test:integration`, the compose smoke test stay green.

## Decisions the owner takes before or during this phase

| #   | Decision                                                       | Needed by | Proposal                                                                                                                                                        |
| --- | -------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | VPS provider and region (EU, GDPR)                             | task 3    | Hetzner (Falkenstein/Nuremberg) or Scaleway/OVH (Paris): 4 vCPU, 8 GB RAM, 160 GB disk is ample for the start                                                   |
| D2  | Public domain (web app + API origin for the desktop builds)    | task 3    | `app.<domain>`; mail sent from `no-reply@<domain>` (Resend needs SPF/DKIM/DMARC on it)                                                                          |
| D3  | Off-site backup storage                                        | task 4    | an S3 bucket at another provider than the VPS (e.g. Backblaze B2 / Scaleway / Hetzner Storage Box), EU, versioning or object lock on                            |
| D4  | Alert channel                                                  | task 5    | email to the owner (through Resend) + a dead-man's switch (self-hosted Uptime Kuma on another machine, or healthchecks.io — receives only pings)                |
| D5  | Deployment trigger                                             | task 6    | manual `deploy/deploy.sh <version>` over SSH first; a GitHub Actions job with a required approval later                                                         |
| D6  | Retention periods (privacy page)                               | task 8    | unverified accounts deleted after 7 days; server logs 14 days; backups 7 daily / 4 weekly / 6 monthly; listings kept until the user deletes them or the account |
| D7  | Phones at launch (spec §11)                                    | task 9    | web + desktop at launch; Android/iOS as API clients once the mobile keystore keeps the session                                                                  |
| D8  | Phase 3 task 10 (remove the local mode) before or after launch | task 9    | after launch, once the import of local listings has been offered to existing users                                                                              |
| D9  | Real provider budgets                                          | task 7    | Cloudflare and Google spending caps set in their consoles; `CLOUDFLARE_DAILY_NEURON_BUDGET` from measured cost                                                  |

---

### Task 1: Production compose and images

- [ ] `compose.yaml` takes images from the registry: `image: ghcr.io/tropi83/aiv-server:${AIV_VERSION:?}` / `aiv-web:${AIV_VERSION:?}` (local builds keep working through `compose.dev.yaml`'s `build:` and the `local` tag).
- [ ] Log rotation on every service (`logging: { driver: json-file, options: { max-size: 10m, max-file: "5" } }`), memory limits (`mem_limit`) sized for D1, `stop_grace_period` checked for the worker (a running job finishes or is retried).
- [ ] Postgres: `shm_size`, a minimal tuning file (`shared_buffers`, `work_mem`) and `pg_stat_statements` off by default; Redis: AOF `everysec` confirmed, `maxmemory` + `noeviction` (already) with a size for D1.
- [ ] Worker liveness from outside the host: the container healthcheck exists since the phase 2 fix (`/tmp/worker-alive`, `worker/heartbeat.ts`), but only Docker sees it. The heartbeat also sets a Redis key (`worker:heartbeat:<hostname>`, TTL 60 s) and `/api/v1/ready` reports `worker: down` (503) when none exists, so the outside uptime check (task 5) catches a dead worker.
- [ ] `scripts/check-compose.mjs` also asserts: every image pinned by version (no `latest`), log rotation present, no `ENABLE_MOCK_PROVIDER` in production config.
- [ ] Tests: unit test of the readiness check with and without heartbeat; compose check in CI. **Commit** `feat(docker): production compose with registry images, log rotation and worker liveness`.

### Task 2: Release workflow for the server images

- [ ] `.github/workflows/release.yml` (or a new `server-release.yml`) on tags `vX.Y.Z`: build `server` and `web` targets (`deploy/Dockerfile`, `VITE_API_ORIGIN=/`) for `linux/amd64` (+ `arm64` if D1 is ARM), push to GHCR as `X.Y.Z` and `sha-<short>`, with SBOM and provenance attestations; a vulnerability scan (Trivy) that fails on fixable critical issues.
- [ ] The desktop bundles of the same tag are built in API mode: `VITE_API_ORIGIN=https://<D2>` as a repository variable, `pnpm tauri:api:build` (generated capability + CSP), Mock provider off.
- [ ] `release` skill and DEVELOPMENT updated (server image tag = app version; how to release only the server).
- [ ] Test: the workflow runs on a `v0.0.0-rc.1`-style pre-release tag without publishing a GitHub release. **Commit** `ci(release): build, scan and publish the server and web images`.

### Task 3: Provisioning runbook and host hardening

- [ ] `OPERATIONS.md` (new, linked from README/DEVELOPMENT/SECURITY): the host from zero — non-root `deploy` user, SSH keys only (password and root login off), firewall (22 from the owner's IPs if possible, 80, 443), unattended security upgrades, Docker from its official repository, time sync, swap, disk alerts.
- [ ] `deploy/provision.sh` (idempotent, `--dry-run`): installs the above on a fresh Debian/Ubuntu LTS; tested on a throwaway VM (or a container) in CI where possible.
- [ ] `scripts/prod-secrets.mjs` (owner runs it on the host): creates `./secrets` with random passwords (as `dev-secrets.mjs`) and **asks** for the real values (Resend, Cloudflare, Gemini) without echoing them; refuses to overwrite an existing secret.
- [ ] DNS for D2, Resend domain verification (SPF, DKIM, DMARC `p=quarantine`), `MAIL_FROM`, `PUBLIC_ORIGIN`, `CADDY_SITE`, `CORS_ORIGINS` (the three Tauri origins only — no localhost) in `.env`.
- [ ] Docs only + scripts with dry-run tests. **Commit** `docs(ops): provisioning runbook and host hardening`.

### Task 4: Backups and restore

- [ ] `backup` one-shot service (same network as Postgres/SeaweedFS, run by a host systemd timer at night): `pg_dump --format=custom` → `age`-encrypted → off-site bucket (D3) with `rclone`; SeaweedFS bucket synced to the off-site bucket (`rclone sync`, encrypted with an `rclone crypt` remote). Redis is not backed up: jobs and credits live in Postgres, the reconciler re-offers what BullMQ lost (document it).
- [ ] Retention per D6 (`rclone` + bucket lifecycle rules); a "backup done" ping to the dead-man's switch (D4) only after both parts succeed; failures logged without secrets.
- [ ] `deploy/restore.sh <date>`: onto an **empty** stack (never over live data without `--i-know`): download, decrypt, `pg_restore`, bucket sync back, then `migrate` and the api; prints the elapsed time.
- [ ] CI test: on the compose CI stack, create data (smoke test), back it up to a local S3 target, wipe the volumes, restore, check the listing and its photos are back (thumbnail answers 200).
- [ ] RPO = 24 h, RTO target = 2 h written in `OPERATIONS.md`. **Commit** `feat(ops): encrypted off-site backups and a tested restore`.

### Task 5: Monitoring and alerting

- [ ] Outside uptime check on `https://<D2>/api/v1/ready` every minute (D4), alert after 3 failures; TLS expiry watched (Caddy renews; the check alerts if not).
- [ ] On the host, a small `deploy/watch.sh` run by a timer every 5 min: disk > 80 %, a container restarting in a loop, `ready` failing locally, failed jobs in the last hour above a threshold, the nightly credit drift check's error line, provider budget paused — each sends one email to the owner (through the api's mailer or `sendmail` to Resend SMTP), rate-limited.
- [ ] No admin web surface at launch: counts are read on the host (`docker compose exec api node dist/stats.js` printing queue depth, jobs by status, sign-ups per day, credits granted/used) for the owner.
- [ ] Logs: `docker compose logs` with rotation (task 1); `OPERATIONS.md` gives the queries for an incident (by `reqId`, by `jobId`); nothing personal is logged (redaction already tested).
- [ ] Tests: `watch.sh` thresholds unit-tested with fake inputs; `stats.js` against the integration database. **Commit** `feat(ops): uptime check, host watch and alerts`.

### Task 6: Deployment and rollback

- [ ] `deploy/deploy.sh <version>`: refuses a dirty `.env`/missing secret; runs the backup (task 4) and waits for it; `docker compose pull`; `migrate`; `up -d --wait`; runs `scripts/server-smoke.mjs` against the live origin with a throwaway account that it deletes (or a read-only smoke if the owner prefers); on failure, `deploy.sh <previous version>` and an alert.
- [ ] Rollback rules in `OPERATIONS.md`: image rollback is safe thanks to expand/contract migrations; a migration that cannot be undone is called out in its PR and needs a restore plan.
- [ ] If D5 = CI: a `deploy` workflow with a required environment approval, SSH with a dedicated key restricted to `deploy.sh`.
- [ ] Test: deploy `vN` → `vN+1` → rollback to `vN` on the local stack with registry images. **Commit** `feat(ops): deployment with a backup first and a rollback path`.

### Task 7: Security pass on the live host

- [ ] Run the `security-review` skill end to end on the phase 1–4 code and the host: headers (HSTS, CSP `connect-src 'self'`, `frame-ancestors`), TLS configuration, open ports (`nmap` from outside: 80/443 only, 22 restricted), containers non-root and read-only where possible, no Docker socket mounted, `.env` and `./secrets` permissions.
- [ ] Real client IPs reach the rate limits (Caddy `X-Forwarded-For` → Fastify `trustProxy` private ranges → `x-aiv-client-ip`): sign-up limit hit from one IP does not block another.
- [ ] Provider keys: Cloudflare token scoped to Workers AI only, Gemini key restricted to the Generative Language API; spending caps (D9); key rotation runbook tested (replace the secret file + restart the worker).
- [ ] `BETTER_AUTH_SECRET` rotation consequences documented (all sessions end; Google tokens re-encrypted?) — no rotation at launch without need.
- [ ] Abuse: free-credit farming (one verified email = 60 credits) — measured after launch; captcha on sign-up kept as an option (spec §7).
- [ ] Findings fixed in their own commits; SECURITY.md updated. **Commit** `docs(security): production review`.

### Task 8: Privacy, retention and data export

- [ ] `PRIVACY.md` rewritten for the account version (local builds as an appendix): host and region (D1), sub-processors with links to their DPAs (VPS, backup storage, Resend, Cloudflare, Google), what is stored and why, retention (D6), rights and how to use them, the privacy contact (owner).
- [ ] Retention job (nightly, worker scheduler): delete accounts never verified after 7 days (D6); nothing else is deleted automatically.
- [ ] Data portability: `GET /api/v1/listings/:id/export` (ZIP: `listing.json` + original + generated photos) and "Export" in the listing menu in API mode — moved here from phase 3 (spec §12 amendment 4); integration test (scoped, cross-user 404, streams without loading everything in memory).
- [ ] In-app links to the privacy page (sign-up screen, Settings → Privacy) and to terms of use **if the owner provides them** (not written by us). **Commit** `feat(api): listing export and retention of unverified accounts` + `docs(privacy): the account version`.

### Task 9: Clients for launch

- [ ] Web: the stack serves the API build (done in phase 3); first-visit wording checked in EN/FR.
- [ ] Desktop: a release built with the production origin (task 2), installed on Windows, sign-in, a pack, sign-out, reopen (session kept from the keychain) — the walk the phase 3 plan could not do in the window.
- [ ] Phones per D7; the import of local listings offered to existing desktop users on their first sign-in (phase 3 task 8).
- [ ] Phase 3 task 10 per D8 (separate plan when the owner gives the go-ahead).

### Task 10: Launch and restore drill (exit criterion)

- [ ] Launch checklist in `OPERATIONS.md` (DNS, TLS, mail deliverability test to Gmail/Outlook, backups ran twice, alerts received once each by forcing them, smoke test on the live origin, provider caps).
- [ ] **Restore drill**: a fresh VM, `provision.sh`, `restore.sh` from last night's off-site backup, the app works there (sign in with a test account, see its listings and photos), time measured against the RTO, the VM destroyed. Result in Progress.
- [ ] Docs: README (how to use the hosted app), CHANGELOG `[Unreleased]`, `backend` and `release` skills, ARCHITECTURE status. **Commit** `docs: phase 4 — production`.

## Progress

Update this section after each task: task number, commit hash, deviations.

- [x] **Task 1** — production compose (registry images via `AIV_VERSION`, log rotation, memory limits, Postgres/Redis tuning), worker liveness in `/ready` (Redis sorted set `worker:heartbeats` rather than per-host keys with TTL: one cheap `ZCOUNT`), `check-compose` assertions with unit tests. Dev/CI use `--env-file deploy/dev.env` (note: the project `.env` is therefore not read by the dev stack). Verified: `pnpm check` (70 files, 369 tests), `pnpm test:integration` (80), `pnpm smoke:server`, and by hand: stopping the worker turns `/ready` into 503 `worker` after 60 s, restarting it restores 200. Not done: the registry images do not exist until task 2.
- [~] **Task 2** — `server-release.yml` written (build → Trivy scan, pinned by SHA → GHCR with SBOM + provenance; action versions checked 2026-10-17). amd64 only (D1 undecided). The desktop job already builds in API mode from `vars.API_ORIGIN`. **Not exercised**: a run needs a pushed tag (publishes to GHCR) — owner to push a `v0.0.0-rc.1`-style tag or run it by hand once; the repository variable `API_ORIGIN` is still to be set.
- [ ] Tasks 3–10 — see above; tasks 3, 7 and 10 need the owner (VPS, DNS, keys).
