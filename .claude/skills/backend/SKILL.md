---
name: backend
description: Use for anything server-side of the backend pivot (ADR 0001) — apps/server (api + worker), docker compose, Postgres/drizzle, BullMQ queues, dispatcher and reconciler, credit ledger, Better Auth, Resend, S3/SeaweedFS, SSE, packages/domain boundaries — the invariants to keep and how to test them without a provider account.
---

# Backend (target architecture — ADR 0001)

**Status (2026-10-12): phases 0 and 1 done** — `apps/server` serves accounts, listings, images, settings and recipes; the compose stack runs (`pnpm stack:up`); the worker, queues, credits and SSE (phase 2) do not exist yet, and no client uses the API (phase 3). How to run, layout and configuration: DEVELOPMENT.md → Server. The binding design is
`docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md`; each phase has its plan in
`docs/superpowers/plans/`. If this skill and the design disagree, the design wins — then fix this skill.

## Shape

- pnpm workspace: `packages/domain` (pure, shared with the client), later `packages/providers` (adapters with an
  injected `fetch`), `packages/contracts` (zod schemas of the REST API and SSE events), `apps/server`.
- `apps/server` builds **one image** with two entrypoints: `api` (Fastify: auth, REST, SSE, uploads) and `worker`
  (BullMQ consumers). Scale workers with `docker compose up -d --scale worker=N`.
- Compose services: `caddy` (only one publishing ports), `api`, `worker`, `postgres`, `redis` (AOF,
  `maxmemory-policy noeviction`), `seaweedfs` (S3 API; MinIO is unmaintained since 2025 — do not reintroduce it), one-shot `migrate` and `storage-init`. `compose.dev.yaml` adds exposed
  ports, Mailpit and Bull Board.

## Invariants (each one has a test)

1. **Provider keys only in the worker**, read from `/run/secrets/*`. The api has no provider key and never calls a
   provider. Egress allowlist in the worker (today's `ALLOWED_HOSTS` logic).
2. **User scoping**: repositories take the session user, never a user id from the request. Another user's id → 404.
3. **Enqueue is one transaction**: lock the balance row, insert generation + jobs, ledger `reserve`, update the
   balance; insufficient credits → 402 and nothing written. BullMQ is fed **after** the commit.
4. **Ledger idempotency**: `reserve:<generationId>`, `refund:<jobId>`, `grant:<userId>:<YYYY-MM>` — unique keys,
   `CHECK (balance >= 0)`. Never update a balance without its ledger row.
5. **Fairness**: Postgres holds the backlog; the dispatcher keeps at most `MAX_ACTIVE_PER_USER` jobs of a user in
   BullMQ, under a Redis lock per user; BullMQ `jobId` = our job id (idempotent add).
6. **Reconciler** (every minute) re-offers `dispatched` jobs unknown to BullMQ and `queued` jobs of idle users.
7. **Retries** reuse the domain: `GenerationError` codes decide retryable vs `UnrecoverableError`;
   `computeBackoffMs` + `retryAfterMs`; a new seed per attempt.
8. **Cancel**: queued → cancelled + refund; waiting → removed + refund; active → Redis cancel flag, the attempt's
   signal aborts, **no result persisted**, refund. Success is written with `WHERE status = 'active'`.
9. **Uploads**: size cap, magic-byte sniffing, sharp re-encode stripping EXIF/GPS, private bucket, bytes streamed by
   the api (`GET /api/v1/images/:id`, `ETag`, `Cache-Control: private, immutable`) — no presigned URL, no public
   storage host. Object keys built from `assertSafeId`-checked ids.
10. **Events**: every job transition is published on `events:<userId>`; SSE replays with `Last-Event-ID`.

## Conventions

- Same TypeScript strictness, Prettier, ESLint and English identifiers as the client; `AppError` +
  `GenerationErrorCode` for errors that reach a client; zod at every boundary (HTTP body, SSE payload, job data,
  env/config).
- Logging: pino JSON to stdout with redaction paths for headers/cookies/tokens and the regexes of `logger.ts`.
  Never log prompts, images, emails in full, or verification links.
- Migrations: drizzle-kit, forward-only, run by the `migrate` one-shot service before `api` / `worker` start.
- Email: Resend from the api only (verification, password reset); Mailpit in dev; never a provider key in a mail.
- Config: non-secret values in `.env` (documented in `.env.example`), secrets as files under `secrets/`
  (git-ignored) mounted as Docker secrets.
- New outbound host (provider, Resend…): worker/api allowlist + `SECURITY.md` + `PRIVACY.md` sub-processors.

## Testing

- Unit: Vitest in Node for `packages/*` and pure server modules.
- Integration: Vitest + **Testcontainers** (postgres, redis, seaweedfs) — atomic enqueue, 402, refund once, cancel in
  each state, fairness with two users, reconciler after a crash between commit and add, cross-user 404, upload
  sniffing and EXIF strip.
- Providers: server-side `MockImageProvider` with the existing scenarios (`success`, `slow`, `flaky`,
  `rate_limited`, `timeout`, `error`, `no_image`). **No test may need a Google, Cloudflare or Resend account.**
- Smoke: `docker compose -f compose.yaml -f compose.ci.yaml up --wait`, then sign-up → upload → generate (mock) →
  SSE → download.

## Patterns already in the code (follow them)

- Routes: `app.withTypeProvider<ZodTypeProvider>()`, schemas from `@aiv/contracts`, `onRequest: guard` (never `preHandler`: the guard must run before the body is read), `sessionUser(req).id` as the first argument of every query.
- Errors: throw `HttpError(status, code, message)` or `AppError`; `http/errors.ts` maps everything else (Fastify, multipart, zod) to `{ code, message }`.
- Better Auth: options checked in the installed types (`@better-auth/core` `types/init-options.d.mts`) and, when behaviour matters, in its code — several defaults were unsafe for us (deletion by fresh session, env-enabled telemetry). Regenerate `src/db/auth-schema.ts` with `auth:schema` when plugins change.
- Tests: unit tests next to the code (`src/**/*.test.ts`, project `server`); integration tests in `test/*.int.test.ts` through `startHarness()` (real Better Auth, Postgres, Redis, SeaweedFS, in-memory mailbox). Prove a security test can fail by breaking the protection once.

## Before claiming done

`pnpm check` green (covers every workspace), Testcontainers suite green, `docker compose up --wait` healthy, docs
updated (SECURITY.md and PRIVACY.md describe the server once the phase ships; CHANGELOG `[Unreleased]`).
