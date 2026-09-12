# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **BUILDING.md** — how to build and package on Windows (`.exe`/`.msi`), macOS (`.app`/`.dmg`, universal), Linux Debian/Ubuntu (`.deb`/AppImage/`.rpm`), Android (debug APK, signed AAB) and iOS, with versions, signing and troubleshooting. **Mobile pre-flight** (`pnpm android:doctor`, `pnpm ios:doctor`, run before `pnpm android:dev` / `android:apk` / `ios:dev`) reports missing JDK/SDK/NDK variables, Rust targets, Xcode/CocoaPods and Windows Developer Mode in a second instead of failing after minutes of compiling. The generated Android project (`src-tauri/gen/android`) is now tracked.
- **Post on Vinted (desktop)** — a “Post N photos on Vinted” button opens Vinted in a separate window (own cookie profile, navigation allow-list, no IPC for vinted.com) and pre-fills the sell form with the photos marked “To post”, the title and the description. A publication panel follows the steps (log in → sell form → fill → check), reports what was filled and offers copy/export fallbacks. The app never clicks Vinted's “Add”. Vinted's terms forbid automated tools: a warning is shown before the first use; Settings → Publishing brings it back and erases the Vinted session. Web and mobile show the button disabled.
- **Mirror selfie shot** for clothing, shoes, bags, accessories, jewelry, watches and leather goods (skipped for the kids category) — packs now have four or five photos; UI counts follow the pack.
- **Projects page** lists every project on the device as a card (cover, image count, last update) with the import zone on top; the empty state only shows when there is nothing yet.
- **Mobile import** (Android/iOS): "Photo library" opens the system media picker through the Tauri dialog plugin (`pickerMode: "image"`; the returned `content://` / `file://` URI is read by the fs plugin), "Take a photo" uses `<input type=file accept="image/*" capture="environment">`, which the Android WebView and iOS WKWebView open as the camera.
- Themed `Select` component (button + portalled listbox, keyboard navigation, type-ahead, flips when there is no room below, works inside modal dialogs) replacing every native `<select>`.

### Changed

- Favourites are now **“To post”** (circled check on tiles, in the lightbox, the gallery filter and on the source image); project schema v2 migrates `favorites` to `toPost`.
- **Gemini is now the copy writer, not an image provider.** Title & description default to `gemini-2.5-flash-lite` (cheapest vision-capable Gemini model, free tier; pricing checked 2026-09-12), with a provider/model picker (⚙ next to the panel) listing Gemini Flash models and Cloudflare Llama vision models with their public prices. Image generation with Gemini is disabled (`GEMINI_IMAGE_GENERATION_ENABLED`) because its image models have no free tier; the adapter and tests stay in place. Copy provider status is now reported even when a provider is not used for images.
- **Product pivot: listing photo studio.** The free prompt is gone; the composer asks for a category and subcategory and generates the four photos a listing needs, each with its own prompt adapted to the product kind (56 packs / 40 kinds, also exposed as built-in recipes). "Generate again" re-runs the same four shots.
- **Title & description from the photo**: a vision model (Cloudflare Llama 4 Scout with JSON-schema output, or Gemini Flash) writes title, description, condition, colour, brand (only if readable) and keywords; editable, copyable, stored in the project.

### Fixed

- Phones: saving an API key failed with “Unexpected error” — the keychain command (desktop-only) was still used as the persistent tier on Android/iOS. Phones now keep keys for the session (the “Remember” switch is replaced by a note); a desktop keychain refusal keeps the key for the session with a clear storage error; errors raised by Rust commands keep their text.
- Android: the header was drawn under the status bar (edge-to-edge); the app now reserves the status bar, navigation bar and keyboard areas, with the bars painted in the app background. iOS: the web UI pads the safe areas (notch, home indicator).
- Android: “Take a photo” opened the gallery — the camera intent was invisible to the app under Android 11+ package visibility; the manifest now declares it in `<queries>`.
- Android/iOS builds: `keyring` was declared for mobile targets too, where keyring 4 refuses to compile without its `v1` feature; it is now a desktop-only dependency (mobile keeps session-only secrets).
- Error messages are provider-aware (`errorMessage()` picks `error.<provider>.<code>` before the generic text): a Cloudflare quota error no longer talks about Gemini. Daily-quota messages now state when the quota resets, in local time with the remaining delay (Cloudflare Workers AI: 00:00 UTC; Gemini: midnight Pacific). Cloudflare 429 `4006` "used up your daily free allocation" is `QUOTA_EXCEEDED` (not retried), and the usage meter's "today" window follows the provider's reset time (UTC for Cloudflare) with a link to the Cloudflare dashboard.
- Cloudflare: 403 `5018`/`3041` ("account not allowed for private model") is reported as a model-access problem, not a bad credential, and the model list is filtered by what the account can actually run (`/ai/models/search`, or `/models` on the Worker).

- Gemini: 429 responses are classified from Google's structured `QuotaFailure`/`RetryInfo` details — daily quota exhaustion is `QUOTA_EXCEEDED` (not retried), a `quotaValue` of 0 is `MODEL_NOT_IN_PLAN`, per-minute throttling stays `RATE_LIMITED` with the delay Google suggests. Previously the doc URL in the message (`…/rate-limits`) made every quota error look like throttling.
- Gemini: requests no longer send `response_format.mime_type` (the live Interactions API rejected `image/png`); the model's default output format is used.
- Auth: concurrent first calls could observe a half-loaded credential (the load promise is now memoized).

### Added

- **Cloudflare Workers AI provider** (default): FLUX.2 [klein] 4B (generation + editing from a reference image, ≈90 free images/day within the 10,000 daily neurons), FLUX.2 [klein] 9B and Stable Diffusion 1.5 img2img. Direct API mode (desktop) and "Your Worker" mode (web + desktop) with a deployable Worker template in `cloudflare-worker/`. Per-job random seeds, Advanced options rendered from the model's option specs, model-driven input preparation, per-provider auth status, model list filtered by account access.
- Clear "no free tier for image models" notice with a link to AI Studio billing; `FREE_TIER_NO_ACCESS` error for `limit: 0` on free-tier metrics; Google usage dashboard links.
- Local usage meter: requests per model over the last minute and the current Pacific day, with limits learned from Google's 429 responses or set manually (composer gauge + Settings → Usage).
- Prettier, EditorConfig and rustfmt configuration; `pnpm check` / `pnpm rust:check` gates.
- GitHub Actions CI (web checks, Rust checks, secrets scan) and a tag-driven release workflow.
- Unit tests for auth (SecretStore, API key, PKCE, OAuth flow, concurrent refresh), models, lib helpers, router, i18n and stores.
- `CLAUDE.md` and project skills in `.claude/skills`.

## [0.1.0] - 2026-09-11

### Added

- Local-first workspace: import (drop / paste / picker), composer with recipes and `{{variables}}`, independent variation jobs with bounded concurrency, retry with backoff, cancellation and timeouts, progressive results.
- Branching: use a result as source, generate more like this, generate again, edit prompt; history tree persisted per project.
- Gallery: grid, fullscreen with zoom/pan, side-by-side compare, favourites, multi-select, export PNG/JPEG/WebP + ZIP.
- Google Gemini provider (Interactions API) with API key or Google OAuth (desktop, PKCE + loopback) and quota-project selection; Mock provider for development.
- Storage: IndexedDB (web) and filesystem (desktop) with schema versioning; settings, diagnostics, EN/FR.
- Tauri 2 shell with OS keychain secrets, minimum permissions and strict CSP.
