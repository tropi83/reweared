# Remove the local mode (phase 3, task 10) — implementation plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. **Resuming?** Read "Progress" at the bottom first. Read the `security-review`, `code-conventions` and `testing` skills before any task.

**Goal:** the app has one mode — the account version on the API. The local-first, bring-your-own-key app (provider keys, Google OAuth, Cloudflare Worker template, generation on the device, local listings) leaves the main line. It is kept, unchanged, on the **`byok` branch** (copy of `main` at `b491606`, before any backend merge).

**Owner's go-ahead:** 2026-10-12 ("Oui, retire-le"), after the `byok` branch was created.

**What stays on the device:** the Vinted pre-fill (desktop window, phone screen), device settings (theme, language — also synced with the account), the session token (keychain), and **read access to the old local storage** for the one-time import of local listings (`LocalImport`, IndexedDB / `$APPDATA`).

## Global Constraints

- Branch `feat/remove-local-mode` from `feat/backend-phase-4`. Conventional Commits, scopes as before; `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `VITE_API_ORIGIN` keeps choosing the origin; unset means `/` (the web bundle and `pnpm dev` through the Vite proxy). Tauri builds still need an absolute origin (`pnpm tauri:api:*`).
- Nothing the server uses moves: `packages/providers` (worker), `@aiv/domain`, `@aiv/contracts`.
- Every remaining feature keeps its tests; tests of removed code go with it; tests that drove the local generation are rewritten against the fake API where the behaviour still exists.
- `pnpm check`, `pnpm rust:check`, `pnpm test:integration`, compose smoke, and the browser walk (scratchpad `walk.mjs`) before the PR.

## Tasks

1. **One mode in the app.** `API_MODE` disappears: `services.api`, `services.runs` and `RemoteListingRepository` always; `AuthGate` always; local branches removed from `listings-store`, `generation-store`, `listing-setup-store`, `bootstrap`, settings sections, copy panel, home texts. `LocalListingRepository` deleted (the import reads the storage directly).
2. **Client-side generation and credentials.** Delete the client providers (Cloudflare, Gemini adapters wiring, Mock), `GenerationQueue` use, `GeminiAuthManager`, OAuth (PKCE, loopback), `CloudflareAuth`, `auth-store`, `query/models`, `query/auth-status`, usage tracking, the composer's provider/model fields, Settings → Providers / Models / Usage / Generation / Storage, `AdvancedOptions`, the Recipes page and store (custom prompts only ran locally; the server's `/recipes` stays for a later feature), `http-client.ts`. `SecretStore` keeps `session_token` only.
3. **Tauri.** `oauth.rs` and its commands removed; `secrets.rs` allows `session_token` only; `capabilities/default.json` loses the Google/Cloudflare `http` scopes and the `opener` URLs that served BYOK; the base CSP `connect-src` loses the provider hosts (the API origin still comes from the generated patch); unused Rust dependencies dropped. SECURITY.md table updated.
4. **Repository.** `cloudflare-worker/` and its CI job removed; `.env.example` loses the OAuth variables.
5. **i18n and tests.** Unused EN/FR keys removed; tests updated as above.
6. **Docs.** README, ARCHITECTURE, SECURITY, PRIVACY, DEVELOPMENT, BUILDING, CLAUDE.md, skills, CHANGELOG: one architecture (the account version); the BYOK release lives on `byok`.

## Progress

- [x] Tasks 1–2 — `e822176` (one mode in the app, client providers and credentials removed).
- [x] Task 3 — `4e9d8a6` (Tauri: OAuth, scopes, CSP, `session_token` only).
- [x] Task 4 — `cloudflare-worker/` and its CI job gone, `.env.example` cleaned.
- [x] Task 5 — no unused EN/FR key left (checked 2026-10-17: 348 keys, all referenced); `pnpm check` green (68 files, 360 tests).
- [~] Task 6 — README, ARCHITECTURE, SECURITY, PRIVACY, DEVELOPMENT, BUILDING, CONTRIBUTING, CHANGELOG done (uncommitted). **Left: `CLAUDE.md` and the skills** (`project-context`, `release`, `security-review`, `testing`, `tanstack-query`, `backend`) still describe the local mode.
- [ ] Before the PR: `pnpm rust:check`, `pnpm test:integration` (Docker), compose smoke, browser walk.
