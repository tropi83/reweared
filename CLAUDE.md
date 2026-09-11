# AI Image Variations — agent instructions

Local-first workspace for AI image variations: React 19 + TypeScript 6 + Vite 8 + Tailwind 4 frontend, Tauri 2 (Rust) shell, Google Gemini provider (BYOK). Read [ARCHITECTURE.md](ARCHITECTURE.md) before structural changes; [SECURITY.md](SECURITY.md) before touching auth, storage, permissions or network.

## Non-negotiables

- **No proprietary backend.** Requests go from the user's device straight to Google. Never add a server, proxy, analytics endpoint or telemetry.
- **Never log, display or persist credentials in clear text.** Logging goes through `src/lib/logger.ts` (redacting). API keys and OAuth tokens live in `SecretStore` only (OS keychain on desktop). Web storage of a key is opt-in and behind the disclaimer.
- **Images leave the device only on Generate**, directly to the configured provider.
- **Google/Tauri APIs: verify the official docs before changing anything** (Interactions API, model ids/capabilities, OAuth, API keys, Tauri plugins). Do not invent endpoints or parameters. Update `GeminiModels.ts` + `DEVELOPMENT.md` when Google changes something, and note the verification date.
- **Minimum Tauri permissions**: every entry in `src-tauri/capabilities/default.json` needs a justification in `SECURITY.md`. New outbound hosts must be added to `ALLOWED_HOSTS` (http-client.ts), the Tauri `http` scope and the CSP `connect-src` together.
- **Never send a parameter a model does not support** — capabilities are centralized in the provider's models catalogue and filtered by `buildRequestForModel`.

## Layout

`src/domain` (pure models/services, no I/O) → `src/infrastructure` (storage, providers, auth, image, http) → `src/app` (services container, zustand stores, router) → `src/features` (React UI) · `src-tauri/src` (keychain + OAuth loopback commands only).

## Workflow

1. Read the relevant skill in `.claude/skills/` (`project-context`, `code-conventions`, `security-review`, `testing`, `git-workflow`, `release`).
2. Implement with tests (Vitest, colocated `*.test.ts(x)`; Rust `#[cfg(test)]`). No CI test may need a Google account — use `MockImageProvider` and `fake-indexeddb`.
3. Before claiming done: `pnpm check` (typecheck + lint + prettier + tests) and `pnpm rust:check` when Rust changed. Run the app (`pnpm dev` / `pnpm tauri dev`) for UI changes.
4. Commit with Conventional Commits; never commit `.env`, keys, tokens, screenshots containing credentials.

## Conventions (summary)

TypeScript strict + `noUncheckedIndexedAccess`; Prettier (160 cols); ESLint with `react-hooks` (React 19 rules — no `setState` directly in effects, use the "adjust state during render" pattern); all user-facing text through `src/i18n` (`en.ts` is the source, `fr.ts` overrides); errors are `AppError` with a `GenerationErrorCode`; ids from `createId()` and validated with `assertSafeId()` before building any path.
