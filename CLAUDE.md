# AI Image Variations — agent instructions

AI photo studio for second-hand listings: React 19 + TypeScript 6 + Vite 8 + Tailwind 4 frontend, Tauri 2 (Rust) shell for desktop and phones, Cloudflare Workers AI (images) and Google Gemini (listing copy). Read [ARCHITECTURE.md](ARCHITECTURE.md) before structural changes; [SECURITY.md](SECURITY.md) before touching auth, storage, permissions or network.

## Transition to a backend (ADR 0001, 2026-10-11)

The product is moving from a local-first, bring-your-own-key app to **user accounts + a server** that runs generations with the platform's provider keys: [ADR 0001](docs/adr/0001-backend-accounts-platform-keys.md), design [`docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md`](docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md), phases 0–4.

- **Until phase 3 ships, the client in `src/` keeps the client rules below** (local-first, BYOK, no call to any server of ours). Do not wire the client to the backend before the phase 3 plan.
- **Server code** (`apps/server`, from phase 1) follows the server rules below and the `backend` skill.
- Know which architecture a document describes: current-release docs say so, target-architecture sections are marked _planned_.

## Non-negotiables

### Everywhere

- **Never log, display or persist credentials in clear text.** Client logging goes through `src/lib/logger.ts` (redacting); server logging through pino with the same redaction. Images and prompts are never logged.
- **Verify the official docs before changing an integration** (Gemini Interactions API, model ids/capabilities, OAuth, Cloudflare Workers AI, Tauri plugins, BullMQ, Better Auth, Resend). Do not invent endpoints or parameters. Update the provider's models catalogue + `DEVELOPMENT.md` when a provider changes something, and note the verification date.
- **Never send a parameter a model does not support** — capabilities are centralized in the provider's models catalogue and filtered by `buildRequestForModel`.
- **No third-party analytics, telemetry or ad SDK.** Server logs stay on our server.
- **The Vinted pre-fill stays on the device** and never clicks Vinted's submit button.
- **CI never needs a provider account** (Google, Cloudflare, Resend): Mock provider, `fake-indexeddb`, Testcontainers.

### Client (`src/`, `src-tauri/`) — current release, until phase 3

- **No backend of ours.** Requests go from the user's device straight to the provider (Cloudflare, Google), with the user's own credentials.
- **Images leave the device only on Generate**, directly to the configured provider.
- Credentials live in `SecretStore` only (OS keychain on desktop). Web storage of a key is opt-in and behind the disclaimer.
- **Minimum Tauri permissions**: every entry in `src-tauri/capabilities/*.json` needs a justification in `SECURITY.md`. New outbound hosts must be added to `ALLOWED_HOSTS` (http-client.ts), the Tauri `http` scope and the CSP `connect-src` together.

### Server (`apps/server`, `packages/*`) — target architecture, from phase 1

- **Provider keys exist only in the worker** (Docker secrets). The api never calls a provider; nothing secret in Postgres, env dumps, images or logs.
- **Every data access is scoped by the session user**; cross-user access is tested and answers 404.
- **Credits move only through the ledger**, in the same transaction as the jobs they pay for, with idempotency keys (reserve, refund, grant).
- **A cancelled job never persists a result**; a failed job is refunded exactly once.
- `packages/domain` stays pure (no I/O, no DOM, no React, no Tauri): client and server both import it.

## Layout

`packages/domain` (`@aiv/domain`: pure models, services, ids, retry — shared with the planned server, Node-tested, no DOM) · client: `src/infrastructure` (storage, providers, auth, image, http, publish) → `src/app` (services container, zustand stores, TanStack Query, router) → `src/features` (React UI) · `src-tauri/src` (keychain, OAuth loopback, Vinted window) · `src-tauri/plugins/vinted-webview` (phones) · `cloudflare-worker/` (template users deploy) · server (phase 1+): `apps/server` (api + worker entrypoints), `compose.yaml` · decisions: `docs/adr/`, designs and plans: `docs/superpowers/`.

## Workflow

1. Read the relevant skill in `.claude/skills/` (`project-context`, `code-conventions`, `security-review`, `testing`, `git-workflow`, `release`, `tanstack-query` for fetched data, `backend` for anything under the server / Docker / queue / credits).
2. Implement with tests (Vitest, colocated `*.test.ts(x)`; Rust `#[cfg(test)]`; server integration tests with Testcontainers). Use `MockImageProvider` and `fake-indexeddb`.
3. Before claiming done: `pnpm check` (typecheck + lint + prettier + knip + tests + prefill freshness) and `pnpm rust:check` when Rust changed. Run the app (`pnpm dev` / `pnpm tauri dev`) for UI changes.
4. Update the docs in the same change when behaviour, architecture, permissions, env vars or user-facing flows change (README, ARCHITECTURE, SECURITY, PRIVACY, DEVELOPMENT, BUILDING, skills, CHANGELOG `[Unreleased]`).
5. Commit with Conventional Commits; never commit `.env`, `secrets/`, keys, tokens, screenshots containing credentials.

## Conventions (summary)

TypeScript strict + `noUncheckedIndexedAccess`; Prettier (160 cols); ESLint with `react-hooks` (React 19 rules — no `setState` directly in effects, use the "adjust state during render" pattern) and `local/no-french-identifiers` (identifiers in English); all user-facing text through `src/i18n` (`en.ts` is the source, `fr.ts` overrides); errors are `AppError` with a `GenerationErrorCode`; ids from `createId()` and validated with `assertSafeId()` before building any path or object key.
