# Backend, accounts and job queue — design

Brainstormed in chat on 2026-10-11. Status: **draft, awaiting owner review**. This is a product pivot: it
reverses non-negotiables of `CLAUDE.md` ("no proprietary backend", "requests go straight from the device
to Google", local-first, BYOK) and the "out of scope: accounts, backend, cloud" list of the
`project-context` skill. Nothing here is implemented before an ADR records the pivot and those documents
are rewritten (phase 0).

## 0. Decisions taken

| Question               | Decision                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whose provider keys    | **Platform keys** (Cloudflare Workers AI, Gemini). Users never see or enter a key.                                                                                                                                                                                                                                                             |
| Local-first            | **Dropped.** Postgres + object storage are the source of truth; web and Tauri become clients.                                                                                                                                                                                                                                                  |
| Backend language       | **TypeScript / Node 22**, pnpm workspace sharing `packages/domain` (`@aiv/domain`) with the frontend.                                                                                                                                                                                                                                          |
| Accounts               | **Built-in auth** (Better Auth): email + password (Better Auth's default scrypt hashing), email verification, Google Sign-In.                                                                                                                                                                                                                  |
| Consumption control    | **Credits + free plan**: ledger, reservation at enqueue, refund on failure. Payment (Stripe) later.                                                                                                                                                                                                                                            |
| Queue                  | **BullMQ + Redis** for dispatch, **Postgres** for job state and credits.                                                                                                                                                                                                                                                                       |
| Hosting                | **One VPS, `docker compose`**, Caddy (automatic TLS). Workers scale with `--scale worker=N`.                                                                                                                                                                                                                                                   |
| Progress to the client | **SSE** (one stream per user, `Last-Event-ID` resume). Commands stay REST.                                                                                                                                                                                                                                                                     |
| Object storage         | **SeaweedFS** (S3 API, Apache-2.0) by default — replaces MinIO, whose Community Edition stopped shipping images in October 2025 and is unmaintained (amendment 2026-10-11). The server only speaks S3, so a managed S3 can replace it in phase 4.                                                                                              |
| Transactional email    | **Resend** (verification, password reset), from the api only; Mailpit in `compose.dev.yaml`. Decided 2026-10-11.                                                                                                                                                                                                                               |
| Image provider         | **Open.** The queue is provider-agnostic (one BullMQ queue per provider, the `ImageProvider` contract). Cloudflare stays the default; the Gemini adapter already exists (`GeminiProvider`, behind `GEMINI_IMAGE_GENERATION_ENABLED`) and can be re-enabled with platform billing; another provider = one more adapter in `packages/providers`. |

## 1. Topology

```
                Internet
                   │ 443
            ┌──────▼──────┐
            │    caddy    │  TLS, static web bundle, /api → api:3000, security headers
            └──────┬──────┘
   ── edge net ────┼──────────────────────────────────────────────
            ┌──────▼──────┐        ┌──────────────┐
            │     api     │──SQL──►│   postgres   │  users, listings, assets, jobs, credit ledger
            │  (Fastify)  │        └──────▲───────┘
            │  SSE, auth  │──S3───►┌──────┴───────┐
            └──┬───────▲──┘        │  seaweedfs   │  originals / generations / thumbnails (private, S3 API)
     add jobs  │       │ pub/sub   └──────▲───────┘
            ┌──▼───────┴──┐               │
            │    redis    │  BullMQ queues, rate limits, cancel flags, event pub/sub
            └──▲──────────┘               │
               │ consume                  │
            ┌──┴──────────┐               │
            │ worker × N  │───────────────┘
            │ (BullMQ)    │──HTTPS──► api.cloudflare.com, generativelanguage.googleapis.com
            └─────────────┘  only container holding provider keys (Docker secrets)
   ── internal net (no published ports) ──────────────────────────
   one-shot: migrate (drizzle migrations), storage-init (bucket)
```

- Only `caddy` publishes ports. `postgres`, `redis`, `seaweedfs` live on an `internal` network.
- `api` and `worker` are **the same image** with two entrypoints (`node dist/api.js` / `node dist/worker.js`):
  one build, shared code, independent scaling.
- **Provider keys exist only in the worker** (`/run/secrets/cloudflare_api_token`, `gemini_api_key`). The
  api never calls a provider, so a compromised api cannot exfiltrate keys. The worker keeps an egress
  allowlist (today's `ALLOWED_HOSTS`).
- Redis: AOF on, `maxmemory-policy noeviction` (BullMQ requirement).
- Images: `node:22-alpine` multi-stage, non-root, read-only root fs, healthchecks on every service,
  `stop_grace_period: 60s` on the worker so active jobs finish (`worker.close()` on SIGTERM).
- Files: `compose.yaml` (prod), `compose.dev.yaml` (ports exposed, Mailpit for emails, Bull Board),
  `.env.example` for non-secret config, secrets as files under `secrets/` (git-ignored).

## 2. Repository layout (pnpm workspace)

```
packages/domain/      ← src/domain + pure parts of src/lib (retry, ids, errors): catalog, shots, mannequin,
                         listing-copy contract + parser, GenerationError, computeBackoffMs, request builder
packages/providers/   ← Cloudflare / Gemini / Mock adapters with an injected `fetch` (no Tauri import)
packages/contracts/   ← zod schemas of the REST API + SSE events, shared by server and clients
apps/web/             ← current src/ (React), talks to the API
apps/server/          ← api.ts, worker.ts, db (drizzle), queue, storage (S3), auth
src-tauri/            ← stays; secrets.rs keeps only the session token
```

Moving `src/domain` is phase 0 and must be behaviour-neutral (all 266+ tests green). Browser-only image code
(`createImageBitmap`, canvas) stays in the web app; the server uses **sharp** for decode, EXIF orientation,
thumbnails and `prepareForProvider`.

## 3. Data model (Postgres 17, drizzle)

| Table                                        | Key columns                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user`, `session`, `account`, `verification` | Better Auth schema                                                                                                                                           |
| `listing`                                    | id, user_id, name, category, subcategory, brand, use_mannequin, copy (jsonb), to_post (jsonb), created/updated_at                                            |
| `image_asset`                                | id, listing_id, kind (`original`/`generation`), s3_key, thumb_key, mime, width, height, bytes, sha256                                                        |
| `generation`                                 | id, listing_id, source_image_id, parent_generation_id, settings (jsonb), status                                                                              |
| `generation_job`                             | id, generation_id, user_id, kind (`image`/`copy`), provider, model, shot_id, prompt, seed, status, attempt, credits, result_image_id, error_code, timestamps |
| `credit_ledger`                              | id, user_id, delta, reason (`grant`/`reserve`/`refund`/`adjust`), job_id, **idempotency_key unique**, created_at                                             |
| `credit_balance`                             | user_id, balance **CHECK (balance >= 0)**, plan                                                                                                              |
| `user_settings`                              | user_id, mannequin (jsonb), locale, theme, composer defaults                                                                                                 |
| `recipe`                                     | id, user_id, …                                                                                                                                               |

Every query is scoped by `user_id` (a repository helper takes the session user, never a raw id from the
request). Ids stay `createId()` + `assertSafeId()`; S3 keys are `u/<userId>/l/<listingId>/<bucket>/<assetId>.<ext>`.

## 4. Job lifecycle

### Enqueue (api, one transaction)

`POST /api/v1/listings/:id/generations` → validate (zod) → build shots with `buildListingShots` from
`packages/domain` → cost = Σ job credits →

```
BEGIN
  SELECT balance FROM credit_balance WHERE user_id = $1 FOR UPDATE
  -- insufficient → 402 INSUFFICIENT_CREDITS, nothing written
  INSERT generation, generation_job × N (status 'queued')
  INSERT credit_ledger (delta = -cost, reason 'reserve', idempotency_key 'reserve:<generationId>')
  UPDATE credit_balance SET balance = balance - cost
COMMIT
→ dispatcher.offer(userId)
```

### Dispatch and fairness

BullMQ has no per-user fairness in its OSS edition, so Postgres holds the backlog and BullMQ only sees what
may run now:

- A user has at most `MAX_ACTIVE_PER_USER` (e.g. 4) jobs in BullMQ. `dispatcher.offer(userId)` moves the
  oldest `queued` jobs of that user into BullMQ (`jobId` = our job id ⇒ idempotent add) and marks them
  `dispatched`. It runs after an enqueue and after each job completes, under a Redis lock per user.
- One BullMQ queue per provider (`gen:cloudflare`, `copy:gemini`, `gen:mock`) with a **limiter** set to the
  platform account's limits (Gemini RPM, Cloudflare requests/min). A Redis counter per UTC day tracks
  Cloudflare neurons; above a budget threshold the queue is paused and new enqueues get
  `PROVIDER_BUDGET_EXHAUSTED` (credits untouched).
- Priority from the plan (BullMQ `priority`), for paid plans later.
- **Reconciler** (repeatable job, every minute): `dispatched` rows unknown to BullMQ or stuck past
  `lockDuration` are re-offered; `queued` rows of idle users are offered. This closes the gap between the
  Postgres commit and the BullMQ add.

### Execution (worker)

Reuses the semantics of today's `GenerationQueue`:

- Per attempt: `AbortSignal.timeout(timeoutMs)` combined with a cancellation signal.
- Errors normalized to `GenerationError`. Retryable codes (`RATE_LIMITED`, `NETWORK_ERROR`, `TIMEOUT`,
  `PROVIDER_UNAVAILABLE`, Cloudflare's flagged-output `CONTENT_REJECTED`) → BullMQ retry with a custom
  backoff strategy = `computeBackoffMs` (exponential + full jitter) honouring `retryAfterMs`; a new seed
  per attempt (`seedForAttempt`). Non-retryable → `UnrecoverableError`.
- Success → sharp thumbnail → S3 put (original bytes + WebP 512 px) → one transaction: `image_asset`
  insert + job `succeeded` + generation status derived (`active | completed | partial | failed | cancelled`).
- Final failure → job `failed` + refund (`idempotency_key 'refund:<jobId>'`, so a replayed failure never
  refunds twice).
- Every transition is published on Redis `events:<userId>`.

### Cancel / retry

- `POST /jobs/:id/cancel`: `queued` → `cancelled` + refund; `dispatched`/`waiting` → `job.remove()` +
  refund; `active` → Redis flag `cancel:<jobId>`, the worker's signal aborts, **no result is persisted**,
  refund. Same invariant as today: a cancelled job never writes a result.
- `POST /jobs/:id/retry` (failed, retryable or user-initiated): new reservation, new seed.

### Crash safety

BullMQ stalled-job detection re-runs jobs of a dead worker; the transition to `succeeded` is conditional
(`WHERE status = 'active'`) so a double run stores one result. Orphan S3 objects from a crash between put and
commit are swept by a daily job (same idea as today's "Remove orphaned files").

## 5. Credits

- Free plan: monthly grant through a repeatable job, `idempotency_key 'grant:<userId>:<YYYY-MM>'`.
- Costs live in one table in `packages/domain` (e.g. 1 credit per image job, 1 per copy), shown in the UI
  before the user clicks _Create the listing_ (`listingReadiness` gains an `insufficientCredits` blocker).
- The balance is a cached column kept in step with the ledger in the same transaction; a nightly check
  compares it to `SUM(delta)` and logs any drift.
- Stripe later: a webhook writes `grant` entries with the event id as idempotency key — nothing else changes.

## 6. API (REST `/api/v1`, zod contracts in `packages/contracts`)

| Route                                                       | Purpose                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/auth/*`                                                   | Better Auth (sign-up, sign-in, Google, verify email, reset password, sessions)           |
| `GET /me`, `PATCH /me/settings`, `DELETE /me`               | profile, settings (mannequin…), account deletion (GDPR: DB rows + S3 prefix)             |
| `GET/POST/PATCH/DELETE /listings[/:id]`                     | listings                                                                                 |
| `POST /listings/:id/images` (multipart)                     | upload: 40 MB cap, magic-byte sniffing, sharp re-encode **stripping EXIF/GPS**           |
| `GET /images/:id?variant=thumb\|full`                       | streamed by the api from the private bucket; `ETag`, `Cache-Control: private, immutable` |
| `POST /listings/:id/generations`, `POST /listings/:id/copy` | enqueue (§4)                                                                             |
| `POST /jobs/:id/cancel`, `POST /jobs/:id/retry`             | §4                                                                                       |
| `GET /events` (SSE)                                         | job transitions, credit balance; `Last-Event-ID` replays from a Redis stream             |
| `GET /credits`, `GET /models`                               | balance + ledger page; models/shots the platform offers                                  |
| `GET /listings/:id/export`                                  | ZIP of a listing (data portability) — phase 3                                            |

Rate limits (Redis) per IP on auth routes and per user on enqueue/upload.

## 7. Security (rewrites SECURITY.md)

- **Provider keys**: Docker secrets mounted in the worker only; never in Postgres, env dumps, logs or images.
  Rotation = replace the file + `docker compose up -d worker`.
- **Passwords**: Better Auth's default hashing (scrypt, accepted by OWASP; no native module). Email verification required before the first generation (abuse of
  free credits). Optional later: captcha on sign-up.
- **Sessions**: web = httpOnly, `Secure`, `SameSite=Lax` cookie + Origin check on mutations; Tauri = bearer
  session token in the OS keychain (`secrets.rs` key set becomes `session_token` only).
- **Authorization**: every repository call scoped by the session user; tests assert cross-user access → 404.
- **Images**: private bucket, bytes streamed through the api (no presigned URL, no public storage host), EXIF/GPS stripped at upload, sent to providers only by a job
  the user started. Providers become **sub-processors** (PRIVACY.md).
- **Logging**: pino with `redact` paths + the regexes of `src/lib/logger.ts` (moved to `packages/domain`);
  prompts and images never logged.
- **Headers** (Caddy): HSTS, CSP (`connect-src 'self'`), `frame-ancestors 'none'`, `nosniff`.
- **Backups**: nightly `pg_dump` + an S3 sync of the bucket (`rclone` or `aws s3 sync`) to an off-site bucket, restore tested.
- **Tauri**: `http` scope, CSP `connect-src` and `ALLOWED_HOSTS` shrink to the API origin; Google/Cloudflare
  hosts, OAuth loopback (`oauth.rs`) and provider settings disappear from the client.

## 8. Frontend changes

- New `ApiClient` (fetch + zod contracts) and `ApiStorageProvider` implementing the existing
  `StorageProvider` where it still fits (listings, images, settings, recipes); `readMeta/writeMeta` and
  `cleanupOrphans` become server concerns.
- The client `GenerationQueue` is no longer used for generation: `generation-store.start()` posts the
  generation and applies SSE events through the existing `applyJobUpdate`. Progressive results are kept.
- **TanStack Query widens**: listings, listing detail, credits and `/models` are server data now. The
  `tanstack-query` skill and §1 of the TanStack spec are updated; SSE events invalidate or patch the cache.
- Settings: the Providers / API key / OAuth / Usage sections are replaced by Account and Credits.
- New routes `#/login`, `#/signup`, `#/verify`; a route guard on the others.
- **Vinted publishing stays on the device**: `publish-payload.ts` downloads the marked images from the API,
  then the existing desktop window / mobile native screen do the same pre-fill.
- One-time opt-in **"Import my local listings"** uploads existing IndexedDB / `$APPDATA` listings.

## 9. Tests

- Domain and providers: unchanged Vitest suites, now in `packages/*`.
- Server: Vitest + **Testcontainers** (postgres, redis, seaweedfs) — enqueue/reserve atomicity, insufficient
  credits, refund idempotency, cancel at each state, per-user cap and fairness (two users, 20 jobs each),
  reconciler after a simulated crash between commit and add, cross-user access, upload sniffing/EXIF strip.
- Provider = server-side `MockImageProvider` (sharp) with today's scenarios (`rate_limited`, `timeout`,
  `flaky`…). **CI still never needs a Google or Cloudflare account.**
- Smoke: `docker compose -f compose.yaml -f compose.ci.yaml up --wait` then sign-up → upload → generate (mock)
  → SSE → download.

## 10. Phases

| Phase | Content                                                                                            | Exit criterion                                |
| ----- | -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 0     | ADR; rewrite CLAUDE.md, SECURITY.md, PRIVACY.md, skills; pnpm workspace; extract `packages/domain` | all existing tests green, no behaviour change |
| 1     | compose (postgres, redis, seaweedfs, caddy), `apps/server` api: auth, listings, uploads, S3        | sign-up → upload → see thumbnail              |
| 2     | worker, BullMQ queues, dispatcher, reconciler, credits, SSE, server-side providers                 | Testcontainers suite green                    |
| 3     | web client switch (ApiClient, stores, auth screens, credits UI), Tauri client, local import        | full flow in `pnpm dev` and `pnpm tauri dev`  |
| 4     | VPS: secrets, backups, monitoring, release workflow building server images                         | restore drill done                            |

## 11. Open questions

- EU hosting and DPA with Cloudflare/Google/Resend for GDPR; data retention period for originals/generations.
- Mobile (Android/iOS): keep the Tauri apps as API clients, or web only at first?
- Moderation of uploads beyond the providers' own filters.
- Pricing of credits vs. real neuron/token cost — needs measured data from phase 2.

## 12. Amendments

- **2026-10-11 (phase 1 plan, owner approved SeaweedFS):** (1) SeaweedFS replaces MinIO as the default S3-compatible store — MinIO Community Edition stopped publishing images and binaries in October 2025 and its repository is unmaintained, so its last image gets no security fixes; (2) `GET /images/:id` streams bytes through the api instead of redirecting to presigned URLs (bucket fully private, authorization in one place); (3) passwords use Better Auth's default scrypt instead of argon2id; (4) the export ZIP moves to phase 3; (5) Redis only backs rate limits in phase 1; (6) the root package stays the web app (no `apps/web`); (7) BMP uploads are refused by the server (sharp cannot decode them) and converted by the client; (8) mail: Resend in production, SMTP to Mailpit in dev. Details: `docs/superpowers/plans/2026-10-11-backend-phase-1.md`.
