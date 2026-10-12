---
name: testing
description: Use when adding or fixing tests — where tests live, how the harnesses work (queue harness, fetch override, fake IndexedDB, mocked image decoding, TanStack Query wrapper), what must be covered per layer, how to run them locally and in CI, and how server tests will run (Testcontainers) once the backend exists.
---

# Testing

## Stack

Vitest 4 with two projects (`app`: jsdom; `domain`: Node) + `@testing-library/react` + `fake-indexeddb`; coverage via `@vitest/coverage-v8`. Rust: `cargo test`. Setup file `src/test/setup.ts` polyfills `Blob.arrayBuffer` / `URL.createObjectURL` / `DataTransfer` and silences canvas. Baseline on 2026-10-11: **51 files, 312 tests** — a refactor must not lower the test count.

## Where

Colocated `*.test.ts(x)` next to the code:

- **Domain** (`packages/domain/src`, Vitest project `domain`: **Node** environment, no `@/` alias, no setup file — never rely on a DOM polyfill; `pnpm exec vitest run --project domain` runs it alone): `generation-queue.test.ts` (queue semantics; the `harness()` helper routes requests back to jobs through `prompt = job.id`), `recipes`, `catalog`, `mannequin`, `listing-copy` (prompt + parser), `publish`, `usage-tracker`, `models/models.test.ts` (errors, status derivation, request builder).
- **Infrastructure**: `providers/{gemini,cloudflare}/*Provider.test.ts`, `*ListingCopy.test.ts`, `GeminiModels.test.ts` (use `__setFetchOverride` from `http-client.ts`; never hit the network), `auth/auth.test.ts` + `SecretStore.test.ts` (secret tiers, API key, PKCE, the OAuth flow with a fake `LoopbackListener`, concurrent refresh), `storage/IndexedDbStorage.test.ts` (one DB name per test) + `rename-migration.test.ts`, `image/image-processing.test.ts`, `publish/publish-bridge.test.ts`, `publish/vinted/prefill.test.ts` (React-style form fixture).
- **App**: `workflow.test.tsx` and `listing-flow.test.ts` (end-to-end through the stores with the Mock provider; image decoding mocked via `vi.mock("@/infrastructure/image/image-processing")`), `listings-store`, `listing-actions`, `publish-store`, `publish-bar`, `query/query.test.tsx`, `app-units.test.ts` (i18n, router, ui/composer/toast stores).
- **Features / components**: one test per component that holds logic (`ListingSetupCard`, `GenerationFeed`, `Lightbox`, `PostButton`, settings sections…), `src/i18n/errors.test.ts` (provider-specific error wording, quota reset times, localization).
- `src/lib/lib.test.ts` (log redaction), `packages/domain/src/lib/{ids,retry}.test.ts` (ids, backoff, timeouts), `scripts/mobile-doctor.test.mjs`, `tools/eslint-rules/no-french-identifiers.test.mjs`.
- Rust: `src-tauri/src/oauth.rs` (callback parsing), `src-tauri/src/vinted.rs` (allow-list, payload limits, URL stripping, poll parsing).

## Rules

- CI never needs a Google, Cloudflare or Resend account or a real key. Fake keys must be obviously fake and still get redacted (`AIzaSy…0000`).
- Every `GenerationErrorCode` a provider can produce has a mapping test.
- Behaviour with side effects (generate, retry, delete, export, publish) is tested through the stores; pure components are tested only when they hold logic.
- Deterministic timing: inject `sleep`/`random` into the queue; mock latency ≤ 5 ms.
- A bug fix starts with a failing test that reproduces it.
- Components that call `useModels` / `useAuthStatus` (TanStack Query) render with `renderWithQuery` from `src/test/render.tsx`; `resetQueryClient()` in `beforeEach`, seed statuses with `seedAuthStatus(id, status)` and model lists with `await ensureModels("mock")`. Never seed `useAuthStore` for provider statuses — that field no longer exists.
- A test belongs to the layer it exercises: a domain test never imports `@/infrastructure` (provider tests live next to the adapters).

## Server (planned — backend phases 1–2)

Unit tests in Node for `packages/*` and pure server modules; integration tests with **Testcontainers** (postgres, redis, minio) for the invariants listed in the `backend` skill (atomic enqueue, 402, refund once, cancel in each state, fairness, reconciler, cross-user 404, upload sniffing/EXIF strip); server-side `MockImageProvider` with the existing scenarios; a compose smoke test in CI. Docker is required locally for the integration suite; unit suites must still run without it.

## Run

```bash
pnpm test                                      # all
pnpm exec vitest run src/infrastructure/auth   # one folder
pnpm test:coverage                             # coverage/ (v8)
cd src-tauri && cargo test
```
