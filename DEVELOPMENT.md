# Development

## Prerequisites

- Node 22+ and pnpm 10
- Rust 1.88+ (stable) and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (WebView2 on Windows, Xcode CLT on macOS, webkit2gtk on Linux)
- Per-platform toolchains (C++ build tools, Xcode, WebKitGTK packages, Android SDK/NDK and Windows Developer Mode, CocoaPods…), exact versions, packaging and signing: **[BUILDING.md](BUILDING.md)**

## Commands

```bash
pnpm install
pnpm dev              # web dev server (http://localhost:1420)
pnpm build            # typecheck + production web bundle in dist/
pnpm tauri dev        # desktop app with hot reload
pnpm tauri build      # desktop installers (see src-tauri/tauri.conf.json > bundle)
pnpm android:doctor   # Android toolchain pre-flight (also runs before android:dev / android:apk)
pnpm android:dev      # run on a phone or emulator with hot reload
pnpm android:apk      # debug APK — release and signing: BUILDING.md
pnpm ios:doctor       # iOS pre-flight (macOS only)
pnpm ios:dev          # run on a simulator or an iPhone with hot reload
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

### Mobile image import

`features/workspace/useImageImport.ts#pickImageFile(source)` picks the mechanism per platform (verified against `tauri-plugin-dialog` 2.7 / `tauri-plugin-fs` 2.5 sources):

- `gallery` — `open({ pickerMode: "image", filters })`: PHPicker on iOS, the media picker (`ACTION_GET_CONTENT`, `image/*`) on Android. The result is a `content://` or `file://` URI; `readFile(uri)` resolves it through the mobile plugin (no fs scope entry needed — URL paths bypass the path scope by design). Opaque media ids become `photo.jpg`.
- `camera` — a hidden `<input type="file" accept="image/*" capture="environment">`: wry's Android `RustWebChromeClient.onShowFileChooser` honours `capture` and hands the shot to the camera app with `ACTION_IMAGE_CAPTURE` (output file through the `${applicationId}.fileprovider` FileProvider); WKWebView opens the camera directly. wry checks `resolveActivity()` first, and since Android 11 other apps are hidden from it unless declared, so the manifest declares `<queries><intent><action android:name="android.media.action.IMAGE_CAPTURE"/></intent></queries>` — without it the check fails, wry logs "Media capture intent could not be launched" and opens the gallery (verified on Android 12, 2026-09-12). No `CAMERA` permission is declared on purpose: wry only asks for it when the manifest declares it, and the camera app takes the picture. Falls back to the plain file input on the web.
- `files` / `auto` — desktop dialog or `<input type=file>`; `auto` becomes `gallery` on mobile.

There is no official Tauri camera plugin (only a barcode scanner), which is why the camera path relies on the WebView's file chooser.

## Cloudflare Workers AI notes

Verified 2026-09-12 against https://developers.cloudflare.com/workers-ai/ (model pages, launch changelogs, REST API, pricing, limits, error codes) and the model JSON schemas in `cloudflare/cloudflare-docs`.

- REST: `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}` with `Authorization: Bearer <token>`. Errors use the v4 envelope `{ success:false, errors:[{code,message}] }`: bad token = 400/401 code 9106/10000, bad account id = 404 code 7003, **5018 = account not allowed for a private model**, **3030 = invalid model input** (e.g. the model has no image tensor) — but also FLUX's output safety filter: `AiError: Your output has been flagged. Please choose another prompt / input image combination` (seen 2026-09-12 on plain shoe product shots, a false positive; not listed on the errors page). `classifyRejectedInput()` therefore reads the message, content filter first: an output flag is `CONTENT_REJECTED` and retryable, and every retry sends a different seed (`seedForAttempt`; a manual Retry draws a new one) because FLUX returns the same image for the same seed. 3036 = daily neurons exhausted (429).
- **FLUX.2 [klein]** (`@cf/black-forest-labs/flux-2-klein-4b`, `-9b`): `multipart/form-data` with `prompt`, `input_image_0..3` (PNG/JPEG, "smaller than 512×512"), `width`/`height` 256–1920, `seed`, `guidance`; steps fixed at 4. Answer: JSON envelope with `result.image` (base64). Pricing 4B: $0.000059 per input tile + $0.000287 per output 512×512 tile ⇒ ≈110 neurons per 1K image.
- **Stable Diffusion 1.5 img2img**: JSON body `prompt`, `image_b64`, `width/height` 256–2048, `num_steps` ≤ 20, `strength`, `guidance`, `negative_prompt`, `seed`; answer = raw PNG bytes. SDXL base/lightning and DreamShaper are _not_ img2img despite the shared schema (3030).
- Model availability: `GET /accounts/{id}/ai/models/search?task=Text-to-Image` (direct) or `GET /models` on the Worker (`env.AI.models()`); catalogue entries missing from the list are greyed out.
- **No CORS** on `api.cloudflare.com` (OPTIONS → 405): direct mode is desktop-only; the web build uses the user's Worker (`cloudflare-worker/`). Hosts: `ALLOWED_HOSTS` + `allowHost()` (worker host), Tauri `http` scope (`https://api.cloudflare.com/*`, `https://*.workers.dev/*`), CSP `connect-src`. A Worker on a custom domain needs its host added to the Tauri scope.
- Secrets: `cloudflare_api_token`, `cloudflare_worker_secret` (allowlisted in `SecretStore.ts` and `secrets.rs`). Account ID and Worker URL live in `metadata/cloudflare-config.json`.
- Catalogue and option specs: `src/infrastructure/providers/cloudflare/CloudflareModels.ts`.

## Gemini API notes

- **Listing copy** (`GeminiListingCopy.ts`): Interactions API with `system_instruction` + text + image parts, `store: false`. Catalogue `GEMINI_TEXT_MODELS` (cheapest first, USD per 1M tokens, ai.google.dev/gemini-api/docs/pricing checked 2026-09-12): 2.5 Flash-Lite 0.10/0.40 (default), 3.1 Flash-Lite 0.25/1.50, 3.5 Flash-Lite 0.30/2.50, 2.5 Flash 0.30/2.50, 3.6 Flash 0.75/3.75 — all with a free tier. The user's choice lives in `settings.copyModelByProvider`; unknown ids fall back to the default (`resolveCopyModel`).
- **Image generation with Gemini is disabled** (`GEMINI_IMAGE_GENERATION_ENABLED = false` in `services.ts`): the provider is not registered in the composer, but `GeminiProvider` and its tests remain so it can be re-enabled by flipping the flag.
- Image generation/editing uses the **Interactions API** (`POST /v1beta/interactions`). Models: `gemini-3.1-flash-image` (default, 512px–4K), `gemini-3.1-flash-lite-image` (1K only), `gemini-3-pro-image` (1K–4K), `gemini-2.5-flash-image` (legacy, no `image_size`). Capabilities are centralized in `src/infrastructure/providers/gemini/GeminiModels.ts` — update that file when Google changes models.
- Billing: image models have **no free tier** in the Gemini API (pricing, 2026-09-11). Free-tier projects get `limit: 0` on `generate_content_free_tier_requests` → `FREE_TIER_NO_ACCESS`. OAuth does not change this: the quota project (`x-goog-user-project`) must have billing. The consumer Gemini app has no public API and must not be automated.
- API keys: new AI Studio keys are _authorization keys_; unrestricted legacy standard keys are rejected by Google (full rejection of standard keys announced for September 2026).
- 429 handling relies on `error.details` (`QuotaFailure` with `quotaId`/`quotaValue`/`quotaDimensions.model`, `RetryInfo.retryDelay`). Per-minute ids contain `PerMinute`, daily ids `PerDay`; `quotaValue: "0"` means the model is not part of the plan (enable billing / Tier 1). Usage is counted locally (`usage-tracker.ts`) because the Gemini API has no consumption endpoint for API keys; daily counters reset at midnight Pacific like Google's.
- Rate limits/quotas depend on the project tier. The queue treats `429` as retryable and honours `Retry-After`; quota exhaustion (`QUOTA_EXCEEDED`) is not retried.

## Vinted pre-fill (desktop)

Flow: `PostButton` → `publish-store` → `PublishBridge` (`TauriVintedBridge` → `vinted_*` commands in `src-tauri/src/vinted.rs`) → a second `WebviewWindow` on vinted.com into which Rust evaluates the pre-fill script. vinted.com gets no Tauri IPC (no capability targets the `vinted` window). Security rationale: SECURITY.md → "Vinted window".

- **Script**: `src/infrastructure/publish/vinted/{prefill,selectors,entry}.ts`, bundled into `src-tauri/scripts/vinted-prefill.js` by `pnpm build:prefill` (Vite library build, IIFE) and compiled into the binary with `include_str!`. The generated file is committed; `pnpm prefill:verify` (part of `pnpm check` and CI) rebuilds it and fails when the committed copy is stale. That directory may only `import type` from `@/domain/services/publish` — nothing from the app exists inside vinted.com.
- **Selectors**: every DOM anchor lives in `selectors.ts` as ordered candidate lists (first match wins). When Vinted changes its form, update that file (specific anchors first, generic fallbacks last), bump its "verified on" date, run `pnpm build:prefill` and commit both files.
- **Inspecting the live form**: in `pnpm tauri dev`, right-click → _Inspect_ inside the Vinted window (devtools exist in debug builds only), open the sell form and run:

  ```js
  JSON.stringify(
    [...document.querySelectorAll("input, textarea")].map((e) => ({
      tag: e.tagName,
      name: e.name,
      id: e.id,
      type: e.type,
      testid: e.dataset.testid,
      accept: e.accept,
    })),
  );
  ```

  then, after attaching a photo by hand, look for the thumbnail anchor (`[data-testid*="thumbnail"]`, `img[src^="blob:"]`).

- **Manual checklist** (any change to the flow): log in (email, then a social login) and restart the app — the session persists; Poster → _Open the sell form_ → _Fill_ reports title and description `filled` and `attached === requested`; nothing is published without clicking Vinted's “Add”; closing the Vinted window mid-flow brings the workspace back with “The Vinted window was closed.”; Settings → Publishing → _Log out of Vinted_ erases the session (the next open asks to log in); closing the main window also closes the Vinted window; the web build shows the button disabled with “Available in the desktop app.”.

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
- `src/domain/services/publish.test.ts` — postability, photo order, Vinted URL stages, report guard; `src/infrastructure/publish/vinted/prefill.test.ts` — form filling on a React-style fixture (fallback selectors, no submit, photos attached once); `src/infrastructure/publish/publish-bridge.test.ts` — command/event mapping, error codes.
- `src/app/publish-store.test.ts` — publish state machine (page events, poll timeout, partial report, stale session, project binding) and payload builder; `src/features/publish/PostButton.test.tsx`, `src/features/settings/PublishSection.test.tsx` — reasons, terms dialog, logout.
- `src-tauri/src/vinted.rs` — navigation allow-list, closed paths, payload limits, page-event URL stripping, poll parsing.

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
