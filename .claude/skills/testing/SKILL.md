---
name: testing
description: Use when adding or fixing tests — where tests live, how the harnesses work (queue harness, fetch override, fake IndexedDB, mocked image decoding), what must be covered per layer, and how to run them locally and in CI.
---

# Testing

## Stack

Vitest 4 + jsdom + `@testing-library/react` + `fake-indexeddb`; coverage via `@vitest/coverage-v8`. Rust: `cargo test`. Setup file `src/test/setup.ts` polyfills `Blob.arrayBuffer` / `URL.createObjectURL` and silences canvas.

## Where

Colocated `*.test.ts(x)` next to the code:

- `domain/services/generation-queue.test.ts` — queue semantics (the `harness()` helper routes requests back to jobs through `prompt = job.id`).
- `domain/services/recipes.test.ts`, `domain/models/models.test.ts` (errors, status derivation, request builder, catalogue consistency).
- `infrastructure/providers/gemini/GeminiProvider.test.ts` — uses `__setFetchOverride` from `http-client.ts`; never hits the network.
- `infrastructure/auth/auth.test.ts` — SecretStore tiers, API-key provider, PKCE, the full OAuth flow with a fake `LoopbackListener` and stubbed Google endpoints, concurrent refresh.
- `infrastructure/storage/IndexedDbStorage.test.ts` — one DB name per test.
- `infrastructure/image/image-processing.test.ts`.
- `app/workflow.test.tsx` — end-to-end through the stores with the Mock provider (image decoding mocked via `vi.mock("@/infrastructure/image/image-processing")`).
- `app/app-units.test.ts` (i18n, router, ui/composer/toast stores), `lib/lib.test.ts` (ids, redaction, backoff, timeouts).
- `src-tauri/src/oauth.rs` — callback parsing.

## Rules

- CI never needs a Google account or a real key. Fake keys must be obviously fake and still get redacted (`AIzaSy…0000`).
- Every `GenerationErrorCode` a provider can produce has a mapping test.
- Behaviour with side effects (generate, retry, delete, export) is tested through the stores; pure components are tested only when they hold logic.
- Deterministic timing: inject `sleep`/`random` into the queue; mock latency ≤ 5 ms.
- A bug fix starts with a failing test that reproduces it.

- Components that call `useModels` / `useAuthStatus` (TanStack Query) render with `renderWithQuery` from `src/test/render.tsx`; `resetQueryClient()` in `beforeEach`, seed statuses with `seedAuthStatus(id, status)` and model lists with `await ensureModels("mock")`. Never seed `useAuthStore` for provider statuses — that field no longer exists.

## Run

```bash
pnpm test                                      # all
pnpm exec vitest run src/infrastructure/auth   # one folder
pnpm test:coverage                             # coverage/ (v8)
cd src-tauri && cargo test
```
