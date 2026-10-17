# AI Image Variations — agent instructions

AI photo studio for second-hand listings: React 19 + TypeScript 6 + Vite 8 + Tailwind 4 frontend, Tauri 2 (Rust) shell for desktop and phones, Cloudflare Workers AI (images) and Google Gemini (listing copy). Read [ARCHITECTURE.md](ARCHITECTURE.md) before structural changes; [SECURITY.md](SECURITY.md) before touching auth, storage, permissions or network.

## One app, on the API (ADR 0001, 2026-10-11; local mode removed 2026-10-12)

The product is **user accounts + a server** that runs generations with the platform's provider keys: [ADR 0001](docs/adr/0001-backend-accounts-platform-keys.md), design [`docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md`](docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md), phases 0–4 (phase 4, production, remains).

- The client has **one mode**: it runs on the API (accounts, server listings and runs; ARCHITECTURE.md). `VITE_API_ORIGIN` only chooses the origin (`/` by default for the web bundle and `pnpm dev`; an absolute origin for Tauri builds). The old local-first, bring-your-own-key app lives on the **`byok` branch** only — do not bring it back.
- The client reaches the server only through `ApiClient` (one origin, `/api/` paths), keeps the session token in `SecretStore` (`session_token`, its only key) and never a provider key. The device keeps the Vinted pre-fill, device settings and read access to the old local storage for the one-time `LocalImport`.
- **Server code** (`apps/server`) follows the server rules below and the `backend` skill.
- Know which architecture a document describes: target-architecture sections are marked _planned_.

## Non-negotiables

### Everywhere

- **Never log, display or persist credentials in clear text.** Client logging goes through `src/lib/logger.ts` (redacting); server logging through pino with the same redaction. Images and prompts are never logged.
- **Verify the official docs before changing an integration** (Gemini Interactions API, model ids/capabilities, Google Sign-In, Cloudflare Workers AI, Tauri plugins, BullMQ, Better Auth, Resend). Do not invent endpoints or parameters. Update the provider's models catalogue + `DEVELOPMENT.md` when a provider changes something, and note the verification date.
- **Never send a parameter a model does not support** — capabilities are centralized in the provider's models catalogue and filtered by `buildRequestForModel`.
- **No third-party analytics, telemetry or ad SDK.** Server logs stay on our server.
- **The Vinted pre-fill stays on the device** and never clicks Vinted's submit button.
- **CI never needs a provider account** (Google, Cloudflare, Resend): server-side Mock provider, `fake-indexeddb` (local import), Testcontainers.

### Client (`src/`, `src-tauri/`)

- **The client talks to our API only** (`ApiClient`, one origin). No provider SDK, key or direct provider request in the app.
- **Images leave the device only on Generate or when uploaded to the account**, to our server.
- The session token lives in `SecretStore` only (OS keychain on desktop). Never a provider key, never a password.
- **Minimum Tauri permissions**: every entry in `src-tauri/capabilities/*.json` needs a justification in `SECURITY.md`. The API origin reaches the Tauri `http` scope and the CSP `connect-src` together, through the generated patch.

### Server (`apps/server`, `packages/*`) — phases 1–3 implemented, phase 4 per the design

- **Provider keys exist only in the worker** (Docker secrets). The api never calls a provider; nothing secret in Postgres, env dumps, images or logs.
- **Every data access is scoped by the session user**; cross-user access is tested and answers 404.
- **Credits move only through the ledger**, in the same transaction as the jobs they pay for, with idempotency keys (reserve, refund, grant).
- **A cancelled job never persists a result**; a failed job is refunded exactly once.
- `packages/domain` stays pure (no I/O, no DOM, no React, no Tauri): client and server both import it.

## Layout

`packages/domain` (`@aiv/domain`: pure models, services, ids, retry — shared with the server, Node-tested, no DOM) · client: `src/infrastructure` (api, auth, storage, image, platform, publish) → `src/app` (services container, zustand stores, TanStack Query, router) → `src/features` (React UI) · `src-tauri/src` (keychain, Vinted window) · `src-tauri/plugins/vinted-webview` (phones) · server: `apps/server` (Fastify api, worker, migrate), `packages/providers` (Cloudflare/Gemini adapters, worker only), `packages/contracts` (API schemas), `deploy/` + `compose.yaml` / `compose.dev.yaml` · decisions: `docs/adr/`, designs and plans: `docs/superpowers/`.

## Workflow

1. Read the relevant skill in `.claude/skills/` (`project-context`, `code-conventions`, `security-review`, `testing`, `git-workflow`, `release`, `tanstack-query` for fetched data, `backend` for anything under the server / Docker / queue / credits).
2. Implement with tests (Vitest, colocated `*.test.ts(x)`; Rust `#[cfg(test)]`; server integration tests with Testcontainers). Use the fake API in client tests, the server-side Mock provider in server tests and `fake-indexeddb` for the local import.
3. Before claiming done: `pnpm check` (typecheck + lint + prettier + knip + tests + prefill freshness) and `pnpm rust:check` when Rust changed; for server changes also `pnpm test:integration` (Docker) and, for the stack, `pnpm stack:up && pnpm smoke:server`. Run the app (`pnpm dev` / `pnpm tauri dev`) for UI changes.
4. Update the docs in the same change when behaviour, architecture, permissions, env vars or user-facing flows change (README, ARCHITECTURE, SECURITY, PRIVACY, DEVELOPMENT, BUILDING, skills, CHANGELOG `[Unreleased]`).
5. Commit with Conventional Commits; never commit `.env`, `secrets/`, keys, tokens, screenshots containing credentials.

## Conventions (summary)

TypeScript strict + `noUncheckedIndexedAccess`; Prettier (160 cols); ESLint with `react-hooks` (React 19 rules — no `setState` directly in effects, use the "adjust state during render" pattern) and `local/no-french-identifiers` (identifiers in English); all user-facing text through `src/i18n` (`en.ts` is the source, `fr.ts` overrides); errors are `AppError` with a `GenerationErrorCode`; ids from `createId()` and validated with `assertSafeId()` before building any path or object key.
