# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Cloudflare: 403 `5018`/`3041` ("account not allowed for private model") is reported as a model-access problem, not a bad credential, and the model list is filtered by what the account can actually run (`/ai/models/search`, or `/models` on the Worker).

- Gemini: 429 responses are classified from Google's structured `QuotaFailure`/`RetryInfo` details — daily quota exhaustion is `QUOTA_EXCEEDED` (not retried), a `quotaValue` of 0 is `MODEL_NOT_IN_PLAN`, per-minute throttling stays `RATE_LIMITED` with the delay Google suggests. Previously the doc URL in the message (`…/rate-limits`) made every quota error look like throttling.
- Gemini: requests no longer send `response_format.mime_type` (the live Interactions API rejected `image/png`); the model's default output format is used.
- Auth: concurrent first calls could observe a half-loaded credential (the load promise is now memoized).

### Added

- **Cloudflare Workers AI provider** (default): Stable Diffusion 1.5 img2img, DreamShaper 8 LCM, SDXL 1.0 and SDXL Lightning — free while in beta. Direct API mode (desktop) and "Your Worker" mode (web + desktop) with a deployable Worker template in `cloudflare-worker/`. Per-job random seeds, Advanced options (strength, guidance, steps, negative prompt), model-driven input preparation (crop to ratio, multiples of 64), per-provider auth status.
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
