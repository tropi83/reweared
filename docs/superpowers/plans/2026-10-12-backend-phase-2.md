# Backend phase 2 — worker, queues, credits, live progress, server-side providers — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Resuming?** Read the "Progress" section at the bottom first. Read the `backend` skill before any task; it lists the patterns phase 1 established (routes, guard at `onRequest`, harness, mutation checks).

**Goal:** A signed-in user can ask the API for a listing's photo pack and its title/description; the request reserves credits and returns at once; a worker generates the images with the **platform's** provider keys, retries what can be retried, refunds what fails, and every step reaches the user live over SSE. Fair between users, within the providers' limits, safe across crashes. Exit criterion (spec §10): the Testcontainers suite proves every invariant of the `backend` skill; the compose smoke test generates with the Mock provider. **No client change** (phase 3).

**Architecture:** `packages/providers` holds the Cloudflare, Gemini and copy adapters with an injected `HttpClient`, shared by the clients (unchanged behaviour) and the worker. The api enqueues in one Postgres transaction (generation + jobs + credit reservation), then a dispatcher feeds BullMQ with at most N active jobs per user; one queue per provider with BullMQ's rate limiter; the worker (`dist/worker.js`, same image, provider keys as Docker secrets) runs jobs with the domain's retry semantics, writes results (sharp, object store), refunds final failures once and publishes each transition to a Redis stream per user, which `GET /api/v1/events` serves as SSE with `Last-Event-ID` replay. A reconciler and a nightly sweep close the gaps a crash can leave.

**Tech stack (registry checked 2026-10-12):** BullMQ 6.3.12 (Redis backend; see decision 2) on ioredis 6 · existing stack of phase 1 (Fastify 5.12, Better Auth 1.7.7, drizzle 0.45, sharp 0.35, SeaweedFS 4.48, Testcontainers 12.2). Read the BullMQ docs for every API used (workers, rate limiting, retrying/backoff strategies, `UnrecoverableError`, `DelayedError`, job ids, repeatable/scheduled jobs, graceful shutdown) and record the URLs + date in the code; do the same for the Cloudflare Workers AI and Gemini endpoints before moving their adapters (CLAUDE.md rule).

**Spec:** `docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md` §3–§5, §9 (binding), its §12 amendments, and the phase 1 plan's Progress (facts about Better Auth, SeaweedFS, compose).

## Global Constraints

- Branch `feat/backend-phase-2` from `feat/backend-phase-1` (or `main` once phase 1 is merged). Conventional Commits; scopes `providers`, `queue`, `worker`, `credits`, `api`, `db`, `docker`, `docs`, `ci`; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Baselines (2026-10-12): 355 unit tests, 37 integration tests.** After every task: `pnpm check` green, `pnpm test:integration` green, no test count drops. Moving client tests into `packages/providers` must keep their count.
- **The shipped clients behave exactly as today**: same requests to Cloudflare and Google, same errors, same UI. Task 1 is a pure refactor for them; `pnpm build`, the app's workflow tests and `pnpm rust:check` prove it.
- **Provider keys exist only in the worker**: the api's config schema has no provider variable and a test asserts it; compose gives the provider secrets to the `worker` service only.
- **Job data in Redis carries ids only** (`{ jobId }`), never an image, a prompt or a user email. Prompts live in Postgres rows; images in the object store.
- **Every invariant gets a test that fails when the protection is removed** (phase 1 practice), at least for: atomic enqueue, refund once, cancelled job never persists, per-user cap, cross-user 404, provider keys absent from the api.
- Credits, costs and budgets are configuration with documented defaults; the owner confirms the numbers (open questions below) — code never hard-codes a price in two places.

## Decisions taken in this plan (beyond the spec)

1. **Platform provider and model are configuration, not user choices**: `IMAGE_PROVIDER` / `IMAGE_MODEL` (default Cloudflare FLUX.2 [klein] 4B), `COPY_PROVIDER` / `COPY_MODEL` (default Gemini 3.1 Flash-Lite). A request may carry per-run options the model supports (aspect ratio, guidance, prompt tweaks) filtered by `buildRequestForModel` — never a provider id or a key.
2. **BullMQ on Redis** (spec). BullMQ 6 now also ships a Postgres backend (`bullmq/postgres`: `createPostgresBackend`, migrations); it would allow enqueue and credit reservation in one transaction and drop the reconciler, but it is new and Redis already runs for rate limits. Revisit only if Redis becomes a burden; the dispatcher/reconciler design does not depend on it.
3. **SSE from Redis Streams**: each user has a capped stream `events:<userId>` (`XADD … MAXLEN ~ 1000`); the SSE handler replays from `Last-Event-ID` (a stream id) then blocks on `XREAD`. One blocking Redis connection per open SSE response, at most 3 per user (4th → 429). Simpler and replay-safe compared with pub/sub + a separate log.
4. **Server-side Mock provider uses sharp** (`apps/server/src/providers/sharp-mock-provider.ts`), with the client Mock's scenarios (`success`, `slow`, `flaky`, `rate_limited`, `timeout`, `error`, `no_image`); enabled only when `ENABLE_MOCK_PROVIDER=true` (dev, CI, tests) — refused in production config.
5. **Source preparation moves to the domain where it is pure** (`computeGeometry`, `inputPreparationFor` already are); the pixel work is sharp on the server and canvas on the client, behind the same `inputPreparationFor(model)` contract.
6. **Generated images go through the same storage path as uploads** (`u/<user>/l/<listing>/generation/<asset>.<ext>` + thumbnail), re-encoded by sharp (no metadata), so the image routes of phase 1 serve them unchanged.
7. **Cloudflare budget guard**: a Redis counter of estimated neurons per UTC day (`estimatedNeurons(model, size)` from the catalogue's pricing); above `CLOUDFLARE_DAILY_NEURON_BUDGET` the `gen:cloudflare` queue is paused and new image enqueues answer 503 `PROVIDER_BUDGET_EXHAUSTED` without reserving credits. New `GenerationErrorCode` in the domain (+ client i18n string, unused by the client until phase 3).

## Open questions for the owner (defaults used until answered)

- Free plan size: `FREE_MONTHLY_CREDITS=60` (≈ 10 listings of 5 photos + text). Costs: 1 credit per image job, 1 per copy job (`CREDIT_COSTS` in `packages/domain`).
- Per-user cap `MAX_ACTIVE_JOBS_PER_USER=4`; provider limits `CLOUDFLARE_MAX_PER_MINUTE=60`, `GEMINI_MAX_PER_MINUTE=15` (free-tier RPM of Flash-Lite — check the current Gemini rate-limit page).
- `CLOUDFLARE_DAILY_NEURON_BUDGET=9000` (keeps ~10 % of the 10,000 free daily neurons as margin) — or a paid Workers plan.

## File map

| File                                                                                                   | Responsibility                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/providers/` (new)                                                                            | Cloudflare + Gemini image and copy adapters, mappers, errors, model catalogues, `HttpClient` interface, allowlist; tests moved from `src/infrastructure/providers` |
| `src/infrastructure/providers/*`                                                                       | Thin client wiring: Tauri/browser `HttpClient`, credential sources (`CloudflareAuth`, `GeminiAuthManager`), the canvas Mock                                        |
| `packages/domain/src/services/{credits,image-geometry}.ts`                                             | Credit costs; `computeGeometry` moved from the client image pipeline                                                                                               |
| `apps/server/src/db/schema.ts` + `drizzle/0001_*.sql`                                                  | `generation`, `generation_job`, `credit_ledger`, `credit_balance`                                                                                                  |
| `apps/server/src/credits/{ledger,routes,grants}.ts`                                                    | Reserve / refund / grant with idempotency keys, balance, monthly grant                                                                                             |
| `apps/server/src/queue/{connection,queues,dispatcher,reconciler,events}.ts`                            | BullMQ queues and limiter config, per-user dispatch, crash recovery, Redis stream events                                                                           |
| `apps/server/src/generations/{plan,enqueue,routes}.ts`                                                 | Build jobs from the listing + domain catalogue, the enqueue transaction, generation/copy/cancel/retry routes                                                       |
| `apps/server/src/worker/{worker,run-image-job,run-copy-job,prepare-source,budget}.ts`, `src/worker.ts` | Worker entrypoint and job execution                                                                                                                                |
| `apps/server/src/providers/{registry,sharp-mock-provider}.ts`                                          | Platform providers built from worker config                                                                                                                        |
| `apps/server/src/events/routes.ts`                                                                     | `GET /api/v1/events` (SSE)                                                                                                                                         |
| `apps/server/src/maintenance/{sweep,drift}.ts`                                                         | Nightly orphan sweep and balance drift check                                                                                                                       |
| `packages/contracts/src/{generation,credits,events}.ts`                                                | Request/response/event schemas                                                                                                                                     |
| `compose.yaml`, `compose.dev.yaml`, `scripts/dev-secrets.mjs`, `scripts/server-smoke.mjs`              | `worker` service with provider secrets, mock in dev, smoke extended to generation + SSE                                                                            |
| Docs                                                                                                   | spec amendments, SECURITY/PRIVACY (sub-processors become real), DEVELOPMENT, ARCHITECTURE, skills, CHANGELOG                                                       |

---

### Task 1: `packages/providers` (pure refactor for the clients)

- [x] **Step 1: Verify the provider docs** (Cloudflare Workers AI REST + model pages for FLUX.2 [klein] 4B/9B and the Llama vision models; Gemini Interactions API, models and rate limits). Record any change in the catalogues + DEVELOPMENT.md with the date. Note: `gemini-2.5-flash-image` was announced to shut down on 2026-10-02 — remove it if the docs confirm.
- [x] **Step 2:** Create `@aiv/providers` (source-only, Node-tested like the domain, lint boundary of shared packages). Define `HttpClient { fetch(url, init): Promise<Response> }` and move the host allowlist (`ALLOWED_HOSTS`, `allowHost`) next to it. Move `cloudflare/{CloudflareMapper,CloudflareErrors,CloudflareModels,CloudflareProvider,CloudflareListingCopy}` and `gemini/{GeminiMapper,GeminiErrors,GeminiModels,GeminiProvider,GeminiListingCopy}`; replace `@/infrastructure/http/http-client` with the injected client and `@/lib/logger` with an injected `{ warn, error }` logger. Credentials come through small interfaces (`CloudflareEndpoint { url(model), headers() }`, `GeminiAuth { getRequestHeaders(), getStatus() }`) that the client's `CloudflareAuth` / `GeminiAuthManager` already satisfy.
- [x] **Step 3:** The client keeps `src/infrastructure/http/http-client.ts` as the `HttpClient` implementation (Tauri plugin or browser fetch, allowlist enforced) and wires the adapters in `app/services.ts`. Tests move with the code; `__setFetchOverride` becomes an injected fake `HttpClient` in the package tests.
- [x] **Step 4:** `computeGeometry` moves to `@aiv/domain/services/image-geometry` (pure); the canvas part stays in the client.
- [x] **Step 5:** `pnpm check` (same total test count), `pnpm build`, `pnpm rust:check`; the client's workflow tests still pass with the Mock. **Commit** `refactor(providers): share the provider adapters with the server`.

### Task 2: Schema for generations, jobs and credits

- [x] **Step 1:** `generation` (id, listing_id, user_id, kind `images|copy`, source_image_id, parent_generation_id, settings jsonb, status, created/updated_at), `generation_job` (id, generation_id, user_id, listing_id, kind, provider, model, shot_id, shot_label jsonb, prompt text, seed int, options jsonb, status `queued|dispatched|active|succeeded|failed|cancelled`, attempt, credits int, result_image_id, error jsonb, dispatched_at, started_at, finished_at; indexes `(user_id, status, created_at)`, `(status, dispatched_at)`), `credit_ledger` (id, user_id, delta int, reason `grant|reserve|refund|adjust`, job_id, generation_id, idempotency_key **unique**, created_at), `credit_balance` (user_id pk, balance int **check ≥ 0**, plan text, updated_at). All cascade from `user`.
- [x] **Step 2:** `db:generate` → `drizzle/0001_*.sql`; integration tests: constraints (negative balance refused, duplicate idempotency key refused), cascades. **Commit** `feat(db): generations, jobs and the credit ledger`.

### Task 3: Credit ledger and the monthly grant

- [x] **Step 1:** `CREDIT_COSTS` in `@aiv/domain/services/credits` (`image: 1`, `copy: 1`) and `jobCost(kind)`; one source of truth for the UI later.
- [x] **Step 2:** `credits/ledger.ts` — `reserve(tx, userId, amount, key)`: `SELECT … FOR UPDATE` on `credit_balance` (creating the row at 0 if absent), 402 `INSUFFICIENT_CREDITS` when short, ledger row + balance update; `refund(tx, jobId)` with key `refund:<jobId>` (a duplicate key is a no-op, not an error); `grant(userId, amount, key)`. No function updates a balance without its ledger row.
- [x] **Step 3:** Monthly free grant: a BullMQ job scheduler (`upsertJobScheduler`, daily) grants `FREE_MONTHLY_CREDITS` with key `grant:<userId>:<YYYY-MM>` to every verified user without one this month; new users get theirs at email verification (Better Auth `afterEmailVerification` hook).
- [x] **Step 4:** `GET /api/v1/credits` → `{ balance, plan, ledger: last 50 entries }` (contract in `@aiv/contracts/credits`).
- [x] **Step 5:** Tests: concurrent reservations never go negative (20 parallel reserves on a balance of 10 → exactly 10 succeed), refund twice = once, grant twice in a month = once, verification grants once. **Commit** `feat(credits): ledger, reservations, refunds and the free monthly grant`.

### Task 4: Queues, dispatcher and reconciler

- [x] **Step 1:** `queue/connection.ts`: BullMQ connections from `REDIS_URL` (read the docs: workers need `maxRetriesPerRequest: null`); `queue/queues.ts`: one `Queue` per enabled provider kind (`gen:cloudflare`, `gen:gemini`, `gen:mock`, `copy:gemini`, `copy:cloudflare`, `copy:mock`), job options: `jobId` = our job id, `attempts` from config, `removeOnComplete/removeOnFail` with a bounded history, backoff `type: "domain"`.
- [x] **Step 2:** `dispatcher.offer(userId)`: under a Redis lock per user, counts the user's `dispatched|active` jobs, moves the oldest `queued` ones up to `MAX_ACTIVE_JOBS_PER_USER` to `dispatched` (conditional update) and adds them to their queue (idempotent by `jobId`). Called after an enqueue, after each job ends, and by the reconciler.
- [x] **Step 3:** `reconciler` (job scheduler, every minute): `dispatched` rows whose BullMQ job is missing (crash between commit and add) are re-added; `active` rows whose BullMQ job is gone and whose `started_at` is older than the lock duration go back to `dispatched`; users with `queued` jobs and free slots are offered.
- [x] **Step 4:** Tests (Testcontainers): fairness — user A enqueues 20 jobs, user B 2, B's jobs are dispatched before A's 5th; the cap holds under concurrent offers; reconciler re-adds a job whose add was skipped (simulate by inserting `dispatched` without adding). **Commit** `feat(queue): per-user dispatch and crash reconciliation on BullMQ`.

### Task 5: Enqueue API, cancel and retry

- [x] **Step 1:** `generations/plan.ts`: from the listing (category, mannequin flag, brand for copy only) and the user's settings, build the shots with `buildListingShots` / `buildShots` (the client's exact prompts), one job per shot, a random seed per job, options filtered by `buildRequestForModel` for the platform model.
- [x] **Step 2:** `POST /api/v1/listings/:id/generations` (`{ sourceImageId?, shotIds?, options? }`) and `POST /api/v1/listings/:id/copy` (`{ language }`): one transaction — listing locked and owned, source image owned, generation + jobs inserted `queued`, `reserve(cost, "reserve:<generationId>")`; then `dispatcher.offer`. 202 + the generation with its jobs. Budget guard (decision 7) before the transaction. Email-verified users only (guard already).
- [x] **Step 3:** `POST /api/v1/jobs/:id/cancel`: `queued|dispatched` → `cancelled` + BullMQ removal + refund; `active` → Redis key `cancel:<jobId>` + `cancelled` once the worker stops; terminal → 409. `POST /api/v1/jobs/:id/retry` (failed only): new job row, new seed, new reservation.
- [x] **Step 4:** `GET /api/v1/listings/:id` returns the generations and jobs now (pin their schemas in `@aiv/contracts` and drop the `unknown` records).
- [x] **Step 5:** Tests: 402 writes nothing (no generation, no job, no ledger row — checked by counts); the reservation and the jobs commit or roll back together (inject a failure after the insert); cross-user 404 on every new route; cancel in each state refunds once. **Commit** `feat(api): enqueue generations and copy with credit reservation`.

### Task 6: Worker

- [x] **Step 1:** Worker config (separate zod schema): provider secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN_FILE`, `GEMINI_API_KEY_FILE`, `ENABLE_MOCK_PROVIDER`, limits, `WORKER_CONCURRENCY`; the api config schema gains a test that it has **no** provider variable. `providers/registry.ts` builds the platform providers with a Node `HttpClient` that enforces the provider allowlist.
- [x] **Step 2:** `run-image-job.ts`: load the job (conditional `dispatched → active`, else skip), read the source from the store, prepare it (`prepare-source.ts`: sharp crop/resize per `inputPreparationFor(model)`), call the provider with an `AbortSignal` combining the attempt timeout and the cancel key (checked every second), seed from `seedForAttempt`. Success → `processUpload`-style re-encode + thumbnail → store → one transaction: `image_asset` (kind `generation`), job `succeeded` (`WHERE status = 'active'`), generation status from `deriveGenerationStatus`. Errors → `toGenerationError`; retryable → rethrow for BullMQ with the domain backoff (`backoffStrategy` using `computeBackoffMs` and `retryAfterMs`); non-retryable or last attempt → `UnrecoverableError` path: job `failed` + `refund`. Cancelled → nothing persisted, refund.
- [x] **Step 3:** `run-copy-job.ts`: same skeleton with the copy provider; the result is written to `listing.copy` (and the listing renamed after the title, as the client does).
- [x] **Step 4:** `budget.ts` (decision 7) increments the neuron counter on success and pauses the queue past the budget; `src/worker.ts` starts workers per enabled queue, closes them on SIGTERM (finishes active jobs within the grace period).
- [x] **Step 5:** `apps/server/src/providers/sharp-mock-provider.ts` with the client Mock's scenarios.
- [x] **Step 6:** Tests (Mock provider, Testcontainers): success writes a generation image served by `/api/v1/images/:id`; `rate_limited` then success retries with a new seed; `error` fails at once and refunds; `timeout` exhausts attempts and refunds once; cancel while active persists nothing; a double delivery of the same job stores one result; worker shutdown leaves no job `active`. **Commit** `feat(worker): run image and copy jobs with retries, refunds and cancellation`.

### Task 7: Live progress (SSE)

- [x] **Step 1:** `queue/events.ts`: `publish(userId, event)` → `XADD events:<userId> MAXLEN ~ 1000 * data <json>`; events: `job` (status, attempt, resultImageId, error code/message), `generation` (status), `credits` (balance). Contracts in `@aiv/contracts/events`.
- [x] **Step 2:** `GET /api/v1/events`: guard at `onRequest`, `text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, heartbeat comment every 15 s, replay from `Last-Event-ID`, then `XREAD BLOCK` on a dedicated connection closed with the response; at most 3 streams per user. Check that Caddy does not buffer the response (`flush_interval -1` on that route if needed).
- [x] **Step 3:** Tests: events arrive in order; reconnecting with `Last-Event-ID` replays exactly the missed ones; another user never receives them; the 4th stream answers 429. **Commit** `feat(api): live job and credit events over SSE`.

### Task 8: Maintenance jobs

- [ ] **Step 1:** Nightly orphan sweep: object keys under `u/` with no matching row (account or listing deleted while the store was down, crash between put and insert) older than 24 h are deleted; counts logged.
- [ ] **Step 2:** Nightly drift check: `credit_balance.balance` vs `SUM(credit_ledger.delta)` per user; a mismatch is logged as an error (never auto-corrected).
- [ ] **Step 3:** Tests for both. **Commit** `feat(worker): nightly orphan sweep and credit drift check`.

### Task 9: Compose, CI and the smoke test

- [ ] **Step 1:** `worker` service (same image, `node dist/worker.js`, read-only, `cap_drop: [ALL]`, `stop_grace_period: 60s`, networks internal + an egress network for the providers, provider secrets **only here**), `dev-secrets.mjs` writes placeholder provider secrets, `compose.dev.yaml` sets `ENABLE_MOCK_PROVIDER=true`, `IMAGE_PROVIDER=mock`, `COPY_PROVIDER=mock`. Caddy: no buffering on `/api/v1/events`.
- [ ] **Step 2:** `server-smoke.mjs` gains: credits granted at verification, enqueue a 2-shot generation with the Mock, SSE until both jobs succeed, download a generated image, copy job fills the title. `docker compose config` check in CI that no provider secret is mounted in `api`.
- [ ] **Step 3:** **Commit** `feat(docker): worker service with the provider keys`.

### Task 10: Documentation

- [ ] Spec §12 amendments (decisions of this plan, answers to the open questions), SECURITY (provider keys in the worker, Redis job data = ids, SSE limits, budget guard), PRIVACY (Cloudflare/Google become real sub-processors for photos sent by the worker; retention of generations), ARCHITECTURE target section, DEVELOPMENT (worker, providers config, mock), skills `backend` (queue/worker patterns), `testing`, `project-context`, `security-review`, CHANGELOG. **Commit** `docs: document the phase 2 worker and credits`.

### Task 11: Final verification

- [ ] `pnpm check`, `pnpm test:integration`, `pnpm rust:check`, `pnpm build`, stack up + `pnpm smoke:server`; logs of a run free of emails, tokens, cookies, prompts and image bytes; `docker compose config` shows provider secrets on `worker` only; the shipped web app still generates locally with the Mock exactly as before (workflow tests + a look in the browser). Update Progress; mark phase 2 done in the skills; ask the owner before pushing.

## Progress

Update this section after each task: task number, commit hash, deviations.

- **Owner, 2026-10-12:** the defaults of "Open questions" are accepted (60 free credits a month, 1 credit per photo and per text, 4 active jobs per user, Cloudflare 60/min, Gemini 15/min, 9,000 neurons/day). The economic model will probably change later: keep every amount in configuration.
- **Task 1 — done** (`git log --grep "share the provider adapters"`); 355 unit tests (unchanged), web build green; `src-tauri` untouched (rust:check not rerun). Deviations and findings:
  - **Pluggable runtime instead of a constructor-injected `HttpClient`**: `@aiv/providers/http` keeps `httpFetch`/allowlist with `setFetchResolver()` and `__setFetchOverride()`, `@aiv/providers/log` has `setProviderLoggerFactory()`. The adapters stayed almost untouched (only imports changed), which is what keeps the client's behaviour identical. The app installs them in `app/services.ts` (explicit `import "@/infrastructure/http/http-client"` so the Tauri fetch is in place before any adapter runs); the worker will install Node's fetch and a pino child.
  - `CloudflareCredentials` (package) is the interface the adapters need; the app's `CloudflareAuth` implements it and re-exports `CloudflareConfig`/`CloudflareMode`. The Cloudflare adapter tests stay in the app (they exercise `CloudflareAuth` with the SecretStore); the three Gemini test files moved and run in a Node `providers` project (22 tests).
  - `computeGeometry` and `fitWithin` moved to `@aiv/domain/services/image-geometry`.
  - Docs checked 2026-10-12 (Gemini models/deprecations/pricing/rate limits/Interactions; Cloudflare FLUX.2 klein pages and pricing): see DEVELOPMENT.md → Gemini API notes. `gemini-2.5-flash-image` has two different shutdown dates on Google's pages — kept in the disabled catalogue, description updated. The FLUX multipart fields are no longer listed on Cloudflare's model page (the schema shows only `multipart`); the adapter's fields are unchanged and verified by its tests.
- **Task 2 — done** (`a544603`). Tables follow the domain's `Generation` / `GenerationJob`; the server adds job states `dispatched` and `active` (to map to `queued` / `generating` for clients) and stores copy runs in the same tables with `kind = 'copy'` (not part of the listing document's generations). Ledger ids are UUIDs (`createId` has no ledger prefix). 40 integration tests.
- **Task 3 — done** (`git log --grep "free monthly grant"`). Deviation: **the monthly grant is lazy** — `ensureMonthlyGrant` runs on `GET /credits` and inside every reservation, keyed `grant:<userId>:<YYYY-MM>` (UTC) — instead of a BullMQ job scheduler plus a grant at email verification: nothing to schedule, no month can be missed, unverified users never reach it (the guard refuses them). The concurrency test first passed without the row lock (only 4 pooled connections, little overlap); after adding an interleaving test the suite fails without the explicit `FOR UPDATE` (the `INSERT … ON CONFLICT DO NOTHING` on the balance row already makes a second transaction wait — both mechanisms are kept). 46 integration tests, 356 unit tests.
- **Task 4 — done** (`fd04e6b`). Queue names use `-` (`gen-mock`, `copy-gemini`): BullMQ uses `:` in its keys. Queue connections are separate ioredis clients with `maxRetriesPerRequest: null` (BullMQ requirement, read in its code). The reconciler is a function; the worker schedules it (task 6). Mutation-checked: without the per-user Redis lock the cap test fails. 51 integration tests.
- **Task 5 — done** (`git log --grep "enqueue generations and copy"`). Deviations and findings:
  - The api config gets the platform model choice and limits (`IMAGE_PROVIDER/MODEL`, `COPY_PROVIDER/MODEL`, `ENABLE_MOCK_PROVIDER` — refused in production —, `MAX_ACTIVE_JOBS_PER_USER`, `JOB_ATTEMPTS`, `CLOUDFLARE_DAILY_NEURON_BUDGET`); a test pins that it never holds a provider credential. Server-side model catalogue: `src/providers/catalogue.ts` (with a `mock-image` model prepared like FLUX.2 [klein]).
  - `reserve()` takes `{ generationId, retryJobId? }`: a retried job reserves under `reserve:job:<jobId>` (the run's key is already used).
  - The budget guard lives in the api (decision 7) as `NeuronBudget` (Redis counter per UTC day); the worker will `record()` what it spends. New domain code `PROVIDER_BUDGET_EXHAUSTED` with EN/FR messages (unused by the client until phase 3).
  - Contract checks found two real defects: the job error code must be the domain's closed union (`GENERATION_ERROR_CODES` is now exported and the type derives from it), and `contracts/listing.ts` ↔ `contracts/generation.ts` imported each other (a schema was `undefined` at load time → 500 on `GET /listings/:id`); shared primitives moved to `contracts/shared.ts`.
  - **Incident (my mistake):** a `git checkout -- .` during debugging discarded the uncommitted edits of this task; they were re-applied from the session's scripts and re-checked (typecheck, 360 unit / 60 integration tests). Changes are now staged before risky commands.
- **Task 6 — done** (`6b70825`); 363 unit tests, 67 integration tests. Deviations and findings:
  - Worker config is its own loader (`src/worker/config.ts`), requiring the keys of the providers actually configured (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, `GEMINI_API_KEY`), never echoing values. Cloudflare runs in "direct" mode through a small `CloudflareCredentials` implementation; Gemini through a header-only `GeminiAuthSource`.
  - Final failures **return** (job marked failed and refunded by us) instead of throwing `UnrecoverableError`: our row is the source of truth, BullMQ only needs to stop. Retryable errors throw `RetryLater`, whose `retryAfterMs` the backoff strategy honours.
  - The event stream (`queue/events.ts`, Redis Streams, capped at ~1000 per user) was written here because the worker publishes; task 7 adds the SSE route.
  - The reconciler runs as a BullMQ job scheduler (`upsertJobScheduler`, every minute) on a `maintenance` queue.
  - **Race found by the tests**: two jobs of one generation finishing together left it `active` (each transaction read the other's job as still running). `refreshGenerationStatus` now locks the generation row first; mutation-checked.
  - A cancel landing while the provider answers is checked again before a result is kept (the 1 s watch alone could miss it).
  - The Mock's `slow` scenario honours `delayMs` (min 300 ms) so cancellation can be tested.
- **Task 7 — done** (`git log --grep "live job and listing events"`); 71 integration tests. Deviations and findings:
  - Events: `job`, `generation`, `listing` (copy written). **No `credits` event** yet: clients refetch `GET /credits` when a job event arrives (the balance moves only at reservation and refund); add the event in phase 3 if the UI needs it.
  - Replay uses `XREAD` from the `Last-Event-ID` (it returns entries after the given id); a missing or malformed id starts after the newest event.
  - **Gap found by the tests**: the starting cursor was computed after `retry:` was sent, so events published in between were lost; it is now computed before the response starts.
  - SSE tests use a real listening server (`app.listen({ port: 0 })`): `inject()` cannot read a hijacked stream.
  - Caddy flushes `text/event-stream` responses immediately (no `flush_interval` needed); to be confirmed by the compose smoke test in task 9.
