# AI Image Variations

[![CI](https://github.com/tropi83/reweared/actions/workflows/ci.yml/badge.svg)](https://github.com/tropi83/reweared/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Tauri 2](https://img.shields.io/badge/Tauri-2.11-24C8D8)
![React 19](https://img.shields.io/badge/React-19.3-61DAFB)
![TypeScript 6](https://img.shields.io/badge/TypeScript-6.0-3178C6)

> **A local-first visual workspace for AI image creation and variations.**
>
> Gemini provides the intelligence. AI Image Variations provides the workflow.

Import an image, describe a change, generate several independent variations, compare them, pick the best one, use it as the new source and iterate — with everything (projects, images, prompts, history) stored on **your** device, and generations sent **directly** from your device to Google Gemini with **your own** credentials.

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Using Gemini](#using-gemini)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Tests & quality gates](#tests--quality-gates)
- [Platform notes](#platform-notes)
- [Documentation](#documentation)
- [Roadmap / status](#roadmap--status)
- [License](#license)

## Features

| Area           | What you get                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Import**     | Drag & drop, clipboard paste, file picker (native dialog on desktop). PNG · JPEG · WebP · GIF · BMP · AVIF, up to 40 MB, EXIF orientation applied, MIME sniffed from bytes |
| **Composer**   | Prompt editor with history, 8 built-in recipes + custom recipes with `{{variables}}`, 1–8 variations, aspect ratios and sizes filtered by the selected model               |
| **Generation** | Each variation is an independent job: bounded concurrency, per-job progress, automatic retry with backoff (rate limits, network, outages), cancel, timeout                 |
| **Branches**   | _Use as source_, _Generate more like this_, _Generate again_, _Edit prompt_. The history keeps the tree (source → generation → results)                                    |
| **Gallery**    | Responsive grid on thumbnails, fullscreen with zoom/pan, side-by-side compare with the source, metadata panel, favourites, multi-select                                    |
| **Export**     | PNG / JPEG / WebP with quality, single file or ZIP for batches, native save dialog on desktop                                                                              |
| **Privacy**    | Local-first, BYOK, no account, no backend, no telemetry. Credentials in the OS keychain on desktop                                                                         |
| **Usage**      | Local per-model gauge (last minute / today, Pacific reset) with limits learned from Google's 429 details or entered manually — Google exposes no consumption API for keys  |
| **Settings**   | Providers (Google OAuth / API key / Mock), usage & quotas, concurrency, retries, timeout, upload size, theme, language (EN/FR), storage tools, diagnostics                 |

## How it works

```
Your device                                         Google
┌──────────────────────────────────────────┐        ┌──────────────────────┐
│ Project (project.json)                   │        │                      │
│  ├─ original/                            │  POST  │ Gemini Interactions  │
│  ├─ generations/  ◄── N independent jobs ├───────►│ API (your key/token) │
│  └─ thumbnails/                          │        │                      │
│ Queue: concurrency · retry · cancel      │        └──────────────────────┘
└──────────────────────────────────────────┘
```

No AI Image Variations server is involved at any point. See [ARCHITECTURE.md](ARCHITECTURE.md) and [PRIVACY.md](PRIVACY.md).

## Quick start

Prerequisites: **Node ≥ 22**, **pnpm ≥ 10**, and for the desktop app **Rust ≥ 1.88** plus the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2 on Windows, Xcode CLT on macOS, webkit2gtk on Linux).

```bash
pnpm install
pnpm dev            # web build at http://localhost:1420
pnpm tauri dev      # desktop app
pnpm test           # 74 tests (Vitest) — see below
```

The **Mock provider** (always available in dev builds, or with `VITE_ENABLE_MOCK_PROVIDER=true`) generates placeholder images without any network call, so the whole workflow can be exercised without a Google account. Switch to it in the composer's _Provider_ select; simulate rate limits, outages or timeouts from Settings → Providers → Mock.

## Using Gemini

AI Image Variations does not pay for your Gemini usage. Your Gemini usage is subject to Google's quotas, model availability and billing rules.

> **Image models have no free tier in the Gemini API** (pricing page, checked 2026-09-11: every image model is "Free tier: Not available"). A key from a project without a linked billing account gets `limit: 0` and the app reports _Free tier — no access_. Link a Cloud Billing account in [AI Studio](https://aistudio.google.com/plan_information); generation then costs a few cents per image. The free image generation in the consumer Gemini app or in AI Studio's web UI is a different product with no public API, and OAuth sign-in does not change the tier: billing is always attached to the Google Cloud project.

### API key (web, desktop, mobile)

1. Create a key in [Google AI Studio](https://aistudio.google.com/api-keys). New keys are _authorization keys_ restricted to the Gemini API by default; unrestricted legacy "standard" keys are rejected by Google.
2. Settings → Providers → _Gemini API key_ → paste → _Save · Test connection_.
3. _Remember on this device_ stores the key in the OS credential store (desktop) or in the browser's localStorage (web, after an explicit warning). Otherwise it lives in memory for the session only.

### Continue with Google (desktop)

Requires the app to be built with an OAuth Desktop client ID (see [DEVELOPMENT.md](DEVELOPMENT.md#configuring-google-oauth-desktop)). The flow is Google's installed-app flow: PKCE + loopback redirect on `127.0.0.1`, consent in your system browser. After signing in, pick the **Google Cloud project** that will be billed (`x-goog-user-project`); it needs the Generative Language API enabled. On the web, use an API key.

### Models

| In the UI    | Model id                      | Sizes                | Notes                     |
| ------------ | ----------------------------- | -------------------- | ------------------------- |
| Balanced     | `gemini-3.1-flash-image`      | 512px · 1K · 2K · 4K | default                   |
| Fast         | `gemini-3.1-flash-lite-image` | 1K                   | fastest / cheapest        |
| Professional | `gemini-3-pro-image`          | 1K · 2K · 4K         | complex edits             |
| Legacy       | `gemini-2.5-flash-image`      | —                    | no `image_size` parameter |

Aspect ratios: 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 (or _Original_). Capabilities are centralized in [`GeminiModels.ts`](src/infrastructure/providers/gemini/GeminiModels.ts); the UI never offers, and the adapter never sends, an unsupported parameter. Verified against the official docs on 2026-09-11.

## Tech stack

Exact versions resolved in `pnpm-lock.yaml` / `Cargo.lock` at the time of writing.

| Layer         | Technology                                                               | Version                                |
| ------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| Language      | TypeScript                                                               | 6.0.3                                  |
| UI            | React / React DOM                                                        | 19.3.0                                 |
| Bundler       | Vite (rolldown-based) + `@vitejs/plugin-react`                           | 8.3.0 / 6.1.1                          |
| Styling       | Tailwind CSS + `@tailwindcss/vite`, `clsx`, `tailwind-merge`             | 4.3.3 · 2.1.1 · 3.6.0                  |
| Icons         | lucide-react                                                             | 1.45.0                                 |
| State         | zustand                                                                  | 5.0.15                                 |
| Web storage   | idb (IndexedDB)                                                          | 8.0.3                                  |
| ZIP export    | fflate                                                                   | 0.8.3                                  |
| Desktop shell | Tauri (Rust) · plugins fs / dialog / http / opener                       | 2.11.5 · 2.5.2 / 2.7.3 / 2.6.0 / 2.5.5 |
| JS bridge     | `@tauri-apps/api`, `@tauri-apps/cli`                                     | 2.11.x                                 |
| Secrets       | `keyring` crate (Windows Credential Manager / Keychain / Secret Service) | 4.2.0                                  |
| Rust          | rustc / cargo, edition 2021                                              | ≥ 1.88 (built with 1.93)               |
| Tests         | Vitest + jsdom + Testing Library + fake-indexeddb + coverage-v8          | 4.1.11 · 27.4.0 · 16.3.3 · 6.2.5       |
| Lint / format | ESLint + typescript-eslint + eslint-plugin-react-hooks · Prettier        | 9.39.5 · 8.70.0 · 7.1.1 · 3.9.6        |
| Package mgr   | pnpm                                                                     | 10.23.0 (Node ≥ 22)                    |
| CI            | GitHub Actions (`ci.yml`, `release.yml`), Dependabot                     | —                                      |

## Project structure

```
src/
  domain/          pure models + services (job queue, provider contract, recipes) — no I/O
  infrastructure/  storage (IndexedDB / Tauri fs), providers (gemini, mock), auth, image pipeline, http
  app/             composition root, zustand stores, hash router, bootstrap, theme
  features/        React UI by feature (projects, workspace, generation, gallery, recipes, settings)
  components/ui/   design-system primitives
  i18n/            en.ts (source of truth) · fr.ts
src-tauri/
  src/secrets.rs   OS keychain commands (closed key allowlist)
  src/oauth.rs     loopback receiver for the OAuth installed-app flow
  capabilities/    minimum Tauri permissions
.claude/skills/    project-context · code-conventions · security-review · testing · git-workflow · release
```

## Scripts

| Command              | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `pnpm dev`           | Vite dev server (web) on port 1420                           |
| `pnpm build`         | Typecheck + production web bundle in `dist/`                 |
| `pnpm tauri dev`     | Desktop app with hot reload                                  |
| `pnpm tauri build`   | Desktop installers                                           |
| `pnpm test`          | Vitest, all suites                                           |
| `pnpm test:watch`    | Vitest in watch mode                                         |
| `pnpm test:coverage` | Coverage report in `coverage/`                               |
| `pnpm typecheck`     | `tsc` strict                                                 |
| `pnpm lint`          | ESLint (`react-hooks` rules on)                              |
| `pnpm format`        | Prettier write (`format:check` in CI)                        |
| `pnpm check`         | typecheck + lint + format:check + test — the pre-commit gate |
| `pnpm rust:check`    | `cargo fmt --check` + `clippy -D warnings` + `cargo test`    |

## Tests & quality gates

74 tests across 10 Vitest suites + Rust unit tests, all offline (Mock provider, `fake-indexeddb`, stubbed Google endpoints):

| Suite                                                    | Covers                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `domain/services/generation-queue.test.ts`               | concurrency, independent failures, retry/backoff, timeout, cancel, manual retry |
| `domain/services/recipes.test.ts`                        | template variables and interpolation                                            |
| `domain/models/models.test.ts`                           | error normalization, status derivation, request builder, model catalogue        |
| `infrastructure/providers/gemini/GeminiProvider.test.ts` | Interactions request/response mapping, HTTP error mapping, model listing        |
| `infrastructure/auth/auth.test.ts`                       | secret tiers, API key, PKCE, OAuth loopback flow, refresh, revoke               |
| `infrastructure/storage/IndexedDbStorage.test.ts`        | round trips, deletion, orphans, unsafe ids, migrations                          |
| `infrastructure/image/image-processing.test.ts`          | MIME sniffing, validation, resize math                                          |
| `app/workflow.test.tsx`                                  | import → 4 variations → branch → reload; partial failure + retry; deletion      |
| `app/app-units.test.ts`, `lib/lib.test.ts`               | i18n, router, stores, ids, log redaction, backoff, timeouts                     |
| `src-tauri/src/oauth.rs`                                 | callback parsing                                                                |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push/PR: web (typecheck, lint, prettier, tests + coverage, build), Rust (fmt, clippy `-D warnings`, tests) and a secrets scan. Tags `vX.Y.Z` trigger [`release.yml`](.github/workflows/release.yml), which builds Windows/macOS/Linux bundles into a draft GitHub release.

## Platform notes

| Platform            | Storage                   | Secrets                               | Google sign-in        | Import                        |
| ------------------- | ------------------------- | ------------------------------------- | --------------------- | ----------------------------- |
| Windows/macOS/Linux | app-data folder (files)   | OS credential store                   | yes (PKCE + loopback) | drop, paste, native dialog    |
| Web                 | IndexedDB (origin-scoped) | memory, or localStorage after warning | no — API key          | drop, paste, file input       |
| Android/iOS         | app-data folder           | session-only (keystore: planned)      | no — API key          | file picker (camera: planned) |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — layers, domain model, job system, storage layout, provider abstraction
- [SECURITY.md](SECURITY.md) — threat model, credential storage, Tauri permissions, CSP, logging rules
- [PRIVACY.md](PRIVACY.md) — what leaves your device and when
- [DEVELOPMENT.md](DEVELOPMENT.md) — setup, OAuth client configuration, building per platform, adding a provider
- [CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md) · [CLAUDE.md](CLAUDE.md) (agent instructions) · `.claude/skills/`

## Roadmap / status

MVP delivered (see [CHANGELOG.md](CHANGELOG.md)). Planned next: mobile secure storage + share sheet + camera, web OAuth, project archive export/import, before/after slider, optional ad-supported free tier (behind an `AdProvider` abstraction that never sees images or prompts).

## License

MIT
