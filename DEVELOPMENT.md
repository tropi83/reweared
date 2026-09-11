# Development

## Prerequisites

- Node 22+ and pnpm 10
- Rust 1.88+ (stable) and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (WebView2 on Windows, Xcode CLT on macOS, webkit2gtk on Linux)
- For mobile: Android Studio / Xcode as described in the Tauri docs

## Commands

```bash
pnpm install
pnpm dev              # web dev server (http://localhost:1420)
pnpm build            # typecheck + production web bundle in dist/
pnpm tauri dev        # desktop app with hot reload
pnpm tauri build      # desktop installers (see src-tauri/tauri.conf.json > bundle)
pnpm tauri android init && pnpm tauri android dev
pnpm tauri ios init && pnpm tauri ios dev
pnpm test             # vitest (unit + integration + workflow)
pnpm check            # typecheck + lint + format:check + test
pnpm rust:check       # cargo fmt --check + clippy + cargo test
```

## Environment

Copy `.env.example` to `.env` (git-ignored). All variables are **public build configuration**; never put user credentials in them.

| Variable                                  | Purpose                                                                                                                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_GOOGLE_OAUTH_CLIENT_ID_DESKTOP`     | OAuth 2.0 client ID of type **Desktop app** — enables _Continue with Google_ in desktop builds                                                                                                                         |
| `VITE_GOOGLE_OAUTH_CLIENT_SECRET_DESKTOP` | the value Google issues alongside a Desktop client. Google's documentation states installed apps cannot keep secrets; it is required by the token endpoint for this client type and is treated as public configuration |
| `VITE_ENABLE_MOCK_PROVIDER`               | `true` to expose the Mock provider in production builds (always on in dev)                                                                                                                                             |
| `VITE_APP_VERSION`                        | shown in Settings → About/Diagnostics                                                                                                                                                                                  |

## Configuring Google OAuth (desktop)

Verified against Google's docs on 2026-09-11 (`ai.google.dev/gemini-api/docs/oauth`, `developers.google.com/identity/protocols/oauth2/native-app`). Re-check them before shipping; Google changes these flows.

1. Create a Google Cloud project and **enable the Generative Language API** (and _Cloud Resource Manager API_ if you want the in-app project picker to work; otherwise users enter a project ID manually).
2. Configure the OAuth consent screen (Google Auth Platform → Branding/Audience). User type _External_. While the app is in _Testing_, only listed test users can sign in; publishing with the `cloud-platform` scope requires Google's verification.
3. Create an OAuth client of type **Desktop app**. Copy the client ID (and the generated secret) into `.env`.
4. Scopes requested by the app: `https://www.googleapis.com/auth/cloud-platform`, `https://www.googleapis.com/auth/generative-language.retriever`, `openid`, `email`.
5. Billing: with user OAuth credentials the app sets `x-goog-user-project` to the project the user picks in Settings, so usage is billed to **their** project, which needs the Generative Language API enabled and the user needs `serviceusage.services.use` on it. Without a project, Google may reject requests or bill the OAuth client's project — the UI therefore asks for it.

Mobile OAuth clients (Android/iOS types, custom-scheme/App Links redirects) are not wired yet; API keys work on mobile.

## Gemini API notes

- Image generation/editing uses the **Interactions API** (`POST /v1beta/interactions`). Models: `gemini-3.1-flash-image` (default, 512px–4K), `gemini-3.1-flash-lite-image` (1K only), `gemini-3-pro-image` (1K–4K), `gemini-2.5-flash-image` (legacy, no `image_size`). Capabilities are centralized in `src/infrastructure/providers/gemini/GeminiModels.ts` — update that file when Google changes models.
- Billing: image models have **no free tier** in the Gemini API (pricing, 2026-09-11). Free-tier projects get `limit: 0` on `generate_content_free_tier_requests` → `FREE_TIER_NO_ACCESS`. OAuth does not change this: the quota project (`x-goog-user-project`) must have billing. The consumer Gemini app has no public API and must not be automated.
- API keys: new AI Studio keys are _authorization keys_; unrestricted legacy standard keys are rejected by Google (full rejection of standard keys announced for September 2026).
- 429 handling relies on `error.details` (`QuotaFailure` with `quotaId`/`quotaValue`/`quotaDimensions.model`, `RetryInfo.retryDelay`). Per-minute ids contain `PerMinute`, daily ids `PerDay`; `quotaValue: "0"` means the model is not part of the plan (enable billing / Tier 1). Usage is counted locally (`usage-tracker.ts`) because the Gemini API has no consumption endpoint for API keys; daily counters reset at midnight Pacific like Google's.
- Rate limits/quotas depend on the project tier. The queue treats `429` as retryable and honours `Retry-After`; quota exhaustion (`QUOTA_EXCEEDED`) is not retried.

## Tests

Colocated `*.test.ts(x)` files, all offline (Mock provider, `fake-indexeddb`, stubbed Google endpoints). The `testing` skill (`.claude/skills/testing/SKILL.md`) documents the harnesses.

- `src/domain/services/generation-queue.test.ts` — concurrency, independent failures, retry/backoff, timeout, cancellation, manual retry.
- `src/domain/services/recipes.test.ts` — interpolation; `src/domain/models/models.test.ts` — errors, status derivation, request builder, catalogue.
- `src/infrastructure/providers/gemini/GeminiProvider.test.ts` — request mapping, response parsing, error normalization, model listing fallback, host allowlist.
- `src/infrastructure/auth/auth.test.ts` — SecretStore tiers, API-key provider, PKCE, OAuth loopback flow, concurrent refresh, `invalid_grant`.
- `src/infrastructure/storage/IndexedDbStorage.test.ts` — round trips, deletion, orphans, unsafe ids, migrations.
- `src/infrastructure/image/image-processing.test.ts` — MIME sniffing, validation, resizing math.
- `src/app/workflow.test.tsx` — import → generate 4 → branch → reload; partial failure + retry; deletion without orphans.
- `src/app/app-units.test.ts`, `src/lib/lib.test.ts` — i18n, router, stores, ids, log redaction, backoff, timeouts.
- `src-tauri/src/oauth.rs` — callback parsing.

```bash
pnpm test            # all suites
pnpm test:coverage   # coverage/ (v8)
pnpm check           # typecheck + lint + prettier + tests (pre-commit gate)
pnpm rust:check      # cargo fmt --check, clippy -D warnings, cargo test
```

CI never needs a Google account: everything runs against the Mock provider and `fake-indexeddb`. See `.github/workflows/ci.yml`.

## Code style

Prettier (160 columns, Tailwind class sorting) + ESLint (`typescript-eslint`, `react-hooks` incl. React 19 rules) + `rustfmt`/`clippy`. EditorConfig is provided. Conventions are detailed in `.claude/skills/code-conventions/SKILL.md`; commit rules in `.claude/skills/git-workflow/SKILL.md`.

## Adding a provider

1. Implement `ImageProvider` under `src/infrastructure/providers/<id>/` with its own models catalogue and error mapper.
2. Register it in `src/app/services.ts`.
3. Add the provider's hosts to `ALLOWED_HOSTS`, the Tauri `http` scope and the CSP `connect-src`.
4. If it needs credentials, add a `CredentialProvider` and a `SecretKey` (frontend `SecretStore.ts` **and** `src-tauri/src/secrets.rs`).

## Icons

`src-tauri/icons` currently contains the Tauri template icons. Replace them with `pnpm tauri icon path/to/1024x1024.png`.
