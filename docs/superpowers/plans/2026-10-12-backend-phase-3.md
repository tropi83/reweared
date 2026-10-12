# Backend phase 3 — the web and Tauri apps on the API — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Resuming?** Read the "Progress" section at the bottom first. Read the `backend`, `code-conventions`, `tanstack-query` and `security-review` skills before any task.

**Goal:** With `VITE_API_ORIGIN` set, the app signs the user in, keeps listings and photos on the server, starts photo packs and listing copy on the server, follows them live and shows the credit balance — on the web (same origin behind Caddy) and in the Tauri apps (bearer token in the OS keychain). Without it, the current local-first app runs unchanged. Exit criterion (spec §10): the full flow works in `pnpm dev` and `pnpm tauri dev` against the compose stack.

**Architecture:** The stores stop talking to `StorageProvider` and `GenerationQueue` directly for listings and runs; they go through two app-level ports chosen at startup — `ListingRepository` (local: today's code; remote: `@aiv/contracts` over `ApiClient`) and `RunEngine` (local: `GenerationQueue` + client providers; remote: API runs + SSE). Accounts are a new `account-store` and `#/login`, `#/signup` routes; server data the UI reads (credits, the platform's run cost) goes through TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md` §8 (binding) and its §12 amendments; the phase 2 plan's Progress (API facts).

## Global Constraints

- Branch `feat/backend-phase-3` from `feat/backend-phase-2`. Conventional Commits; scopes `api-client`, `auth`, `listing`, `ui`, `tauri`, `i18n`, `api`, `docs`; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Local mode keeps working**: with `VITE_API_ORIGIN` unset every existing test passes unchanged (baseline 363 unit, 73 integration) and the app behaves as before. New behaviour is tested in both modes where it diverges.
- All user-facing text through `src/i18n` (EN + FR). React 19 hook rules. Every response parsed with the `@aiv/contracts` schema; every error becomes an `AppError` with a code the UI already knows (`UNAUTHENTICATED`, `EMAIL_NOT_VERIFIED`, `INSUFFICIENT_CREDITS`, `PROVIDER_BUDGET_EXHAUSTED`…).
- **Security** (security-review skill): web sessions are httpOnly cookies (the app never sees them); Tauri keeps the bearer token in the OS keychain only (`session_token` in `secrets.rs` + `SecretStore`), never in logs or diagnostics; the API origin is added to `ALLOWED_HOSTS`, the Tauri `http` scope and the CSP `connect-src` together, with a SECURITY.md line.
- Images still enter and leave the app through the same pipeline (validation, thumbnails in the gallery from the server's `thumb` variant, export, Vinted payload).

## Decisions taken in this plan (beyond the spec)

1. **Build-time switch** `VITE_API_ORIGIN` (`/` for the web bundle served by Caddy, `https://app.example.com` for Tauri builds, `http://localhost:8080` in dev). Unset = local mode.
2. **Removing the local mode is not part of this plan.** BYOK, Google OAuth, the Cloudflare Worker template and local generation stay until the owner decides (it deletes working code and the offline phone experience). A short follow-up plan will do it.
3. **Progress = refetch on events**: an SSE `job`/`generation`/`listing` event triggers a fetch of that listing's document (a few KB) rather than patching the store field by field — one source of truth, no client-side state machine to drift.
4. **SSE transport**: `EventSource` on the web (same-origin cookies); a `fetch` stream reader in Tauri (EventSource cannot send `Authorization`). One shared parser.
5. **Local import** imports each listing's original photo, category, brand, mannequin flag, copy and "to post" marks for originals; **generated photos are not imported** (the server only accepts originals in phase 1; they can be regenerated). Opt-in, one listing at a time, resumable.
6. **Server additions needed**: `@fastify/cors` for the Tauri origins (`tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`) exposing `set-auth-token`; those origins in Better Auth's `trustedOrigins`; `GET /api/v1/platform` (run cost per kind, image model's aspect ratios and options) so the UI never hard-codes them.

## File map

| File                                                                                           | Responsibility                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/infrastructure/api/{ApiClient,session,sse}.ts`                                            | fetch wrapper (base URL, cookie/bearer, zod parsing, error mapping), session token storage (Tauri), SSE parser + transports      |
| `src/app/ports/{listing-repository,run-engine}.ts`                                             | the two ports; `local-*` adapters wrapping today's code; `remote-*` adapters over the API                                        |
| `src/app/stores/account-store.ts`                                                              | session, sign-up/in/out, verification state, account deletion                                                                    |
| `src/app/query/{credits,platform}.ts`                                                          | TanStack Query: balance, platform info                                                                                           |
| `src/features/account/{SignInView,SignUpView,VerifyEmailView,AccountSection,CreditsBadge}.tsx` | auth screens, Settings → Account, header badge                                                                                   |
| `src/features/import/ImportLocalDialog.tsx`, `src/app/import-local.ts`                         | one-time import of local listings                                                                                                |
| `src/app/services.ts`, `router.ts`, `bootstrap.ts`                                             | mode selection, auth guard routes                                                                                                |
| `src-tauri/src/secrets.rs`, `capabilities`, `tauri.conf.json`                                  | `session_token`, API host in scope + CSP                                                                                         |
| `apps/server/src/{app.ts,auth/auth.ts,platform/routes.ts}`                                     | CORS, trusted Tauri origins, `/platform`                                                                                         |
| Docs                                                                                           | SECURITY, PRIVACY (now true for API builds), DEVELOPMENT (running the app on the stack), ARCHITECTURE, README, skills, CHANGELOG |

---

### Task 1: Server additions for the clients

- [ ] `GET /api/v1/platform` (`{ runCost: { image, copy }, imageModel: { aspectRatios, options }, freeMonthlyCredits }`, contract in `@aiv/contracts/platform`), `@fastify/cors` with `CORS_ORIGINS` (default the three Tauri origins; credentials only for same-origin cookies, `exposedHeaders: ["set-auth-token"]`), Better Auth `trustedOrigins` = `PUBLIC_ORIGIN` + `CORS_ORIGINS`. Integration tests: preflight from `tauri://localhost` allowed and exposes `set-auth-token`, other origins refused; `/platform` content. **Commit** `feat(api): platform info and CORS for the desktop and phone apps`.

### Task 2: `ApiClient`, session token, SSE parser

- [ ] `ApiClient` (`VITE_API_ORIGIN`, `credentials: "include"` on the web, `Authorization: Bearer` from `session.ts` in Tauri, captures `set-auth-token` after sign-in, parses with contracts, maps `{ code, message }` to `AppError`, 401 → `onUnauthenticated` callback); `session.ts` (`SecretStore` key `session_token`; `secrets.rs` allowlist); `sse.ts` (parser of `id/event/data` blocks + `EventSource` and fetch-stream transports with `Last-Event-ID` resume and backoff). Unit tests with a fake fetch: auth headers per platform, error mapping, token capture, parser on chunked input, resume id. **Commit** `feat(api-client): typed API client, session token and SSE transport`.

### Task 3: Accounts in the app

- [ ] `account-store` (load session on start, sign up → "check your email", sign in, sign out, resend verification, request password reset, delete account → "check your email"), routes `#/login`, `#/signup`, `#/verify`, guard sending signed-out users to `#/login` in API mode, `SignInView`/`SignUpView`/`VerifyEmailView` (accessible forms, EN/FR, errors from codes), Settings → Account. Tests: store transitions with a fake API, guard, views render and submit. **Commit** `feat(auth): sign-up, sign-in and account settings in API mode`.

### Task 4: `ListingRepository` port

- [ ] Extract today's listing persistence from `listings-store` into `local-listing-repository` (no behaviour change: all listing tests green), then `remote-listing-repository` (list, open, create from file = POST + upload, rename/patch with debounced PATCH of changed fields, delete, delete images, images through `GET /images/:id?variant=`; duplicate = create + upload of the original). `image-urls` cache keyed the same way. Tests: remote repository against a fake API (patch only changed fields, upload order, error mapping). **Commit** `refactor(listing): listing persistence behind a repository port` then `feat(listing): listings stored on the server in API mode`.

### Task 5: `RunEngine` port and live progress

- [ ] `local-run-engine` wraps today's `GenerationQueue` path (no behaviour change); `remote-run-engine`: start pack (`POST /generations` with shot ids, aspect ratio, options), copy (`POST /copy`), cancel/retry (`/jobs/:id/...`), subscribes to SSE and refetches the listing on events (decision 3); `generation-store`/`listing-setup-store` call the engine. "Generate this photo again" = retry of a completed job's shot via `POST /generations` with that shot id. Tests: remote engine with fake API + scripted SSE (progress reaches the store, 402 and 503 surface as toasts with the right code, cancel). **Commit** `feat(listing): photo packs and listing copy run on the server in API mode`.

### Task 6: Credits and platform in the UI

- [ ] `useCredits`, `usePlatform` (TanStack Query; invalidated by job events), `CreditsBadge` in the header, the cost on the "Create the listing" button and its `listingReadiness` blocker (`insufficientCredits`), Settings: Providers/Models/Usage hidden in API mode, Account + Credits shown. Tests: readiness with credits, badge, settings sections per mode. **Commit** `feat(ui): credits and run cost in API mode`.

### Task 7: Tauri wiring

- [ ] API host in `ALLOWED_HOSTS` (from `VITE_API_ORIGIN`), Tauri `http` scope and CSP `connect-src` (build-time; `tauri.conf.json` documents the production host), `session_token` in `secrets.rs` with its test, SECURITY.md table rows. `pnpm rust:check`. **Commit** `feat(tauri): reach the API with a keychain-held session`.

### Task 8: Import local listings

- [ ] `import-local.ts` (reads local storage, creates each listing on the server, uploads the original, patches metadata, records progress in local meta so it resumes), `ImportLocalDialog` (offered once after the first sign-in when local listings exist; Settings → Account to run it again). Tests with fake storage + fake API. **Commit** `feat(listing): import local listings into the account`.

### Task 9: End-to-end check, docs

- [ ] Run the stack + `pnpm dev` with `VITE_API_ORIGIN=http://localhost:8080` (Vite proxy `/api` → stack for same-origin cookies) and walk the flow in a browser (sign-up, verify via Mailpit, import, upload, create the listing, live progress, copy, Vinted payload build, sign-out); `pnpm tauri dev` against the stack. Docs: DEVELOPMENT (running the app in API mode), SECURITY/PRIVACY (API builds), ARCHITECTURE (ports), README, skills (`tanstack-query`: server data now includes credits/platform; `project-context`), CHANGELOG. **Commit** `docs: the apps on the API`.

### Task 10 (needs the owner's go-ahead): remove the local mode

- [ ] Not started without explicit approval: delete BYOK credentials, Google OAuth loopback, provider settings, the Cloudflare Worker template and local generation; make the API mode the only mode; update ADR status and docs.

## Progress

Update this section after each task: task number, commit hash, deviations.

_Nothing done yet._
