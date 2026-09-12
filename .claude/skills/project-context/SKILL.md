---
name: project-context
description: Use at the start of any task on AI Image Variations — product intent, architecture map, where things live, decisions already taken (Gemini Interactions API, keyring, OAuth loopback), and what is explicitly out of scope.
---

# Project context — AI Image Variations

## Product in one paragraph

Local-first AI photo studio for second-hand listings (Vinted-style): import the item's photo → choose category/subcategory (10 → 56, `listing-catalog.ts`) → the app generates the listing photos with predefined, kind-specific prompts (retouched / studio / in use or worn / folded or detail, + mirror selfie for wearables except kids) → compare, pick, export; a vision model writes the title + description (Gemini 2.5 Flash-Lite by default, free tier; Cloudflare Llama as alternative). No free prompt in the main flow (custom recipes remain for power users). BYOK: images = Cloudflare Workers AI only (Gemini image generation disabled via `GEMINI_IMAGE_GENERATION_ENABLED`), copy = Gemini by default. No account, no backend, no cloud.

## Map

| Concern                                                     | Where                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Domain models / errors                                      | `src/domain/models/*` (`AppError`, `GenerationErrorCode`, `listing.ts`)                                                     |
| Listing taxonomy + 4-shot plans, listing copy contract      | `src/domain/services/listing-catalog.ts`, `listing-copy.ts`                                                                 |
| Job queue (concurrency, retry, cancel, timeout)             | `src/domain/services/generation-queue.ts`                                                                                   |
| Provider contract + request builder                         | `src/domain/services/image-provider.ts`                                                                                     |
| Gemini adapter, models catalogue, error mapping             | `src/infrastructure/providers/gemini/*`                                                                                     |
| Cloudflare Workers AI adapter, auth (direct/worker), models | `src/infrastructure/providers/cloudflare/*`, `cloudflare-worker/`                                                           |
| Mock provider (dev/tests)                                   | `src/infrastructure/providers/mock/MockImageProvider.ts`                                                                    |
| Credentials (API key, OAuth PKCE+loopback, SecretStore)     | `src/infrastructure/auth/*`                                                                                                 |
| Storage (IndexedDB web / Tauri fs native), migrations       | `src/infrastructure/storage/*`                                                                                              |
| Image validation/decoding/thumbnails/export                 | `src/infrastructure/image/*`                                                                                                |
| HTTP entry point + host allowlist                           | `src/infrastructure/http/http-client.ts`                                                                                    |
| Composition root + stores                                   | `src/app/services.ts`, `src/app/stores/*`                                                                                   |
| UI by feature                                               | `src/features/{projects,workspace,generation,gallery,recipes,settings}`                                                     |
| i18n                                                        | `src/i18n/en.ts` (source), `fr.ts`                                                                                          |
| Rust commands (keychain, OAuth loopback)                    | `src-tauri/src/{secrets,oauth}.rs`                                                                                          |
| Permissions / CSP                                           | `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`                                                          |
| Vinted publishing (domain, payload, store, UI)              | `src/domain/services/publish.ts`, `src/app/publish-payload.ts`, `src/app/stores/publish-store.ts`, `src/features/publish/*` |
| Vinted bridge + injected script                             | `src/infrastructure/publish/*` (`vinted/` = script bundled by `pnpm build:prefill`), `src-tauri/src/vinted.rs`              |
| Builds per platform, mobile pre-flight                      | `BUILDING.md`, `scripts/mobile-doctor.mjs` (`pnpm android:doctor`, `pnpm ios:doctor`)                                       |

## Decisions already taken (do not re-litigate without new facts)

- **Default provider = Cloudflare Workers AI**, model **FLUX.2 [klein] 4B** (multipart API, reference image ≤ 512 px, ≈110 neurons per 1K image inside the 10,000 free daily neurons) because Gemini image models have no free tier. SD 1.5 img2img is private on many accounts (5018); SDXL/DreamShaper have no image input (3030) and must not be re-added as img2img. `api.cloudflare.com` has no CORS → direct mode desktop-only; web uses the user's own Worker (`cloudflare-worker/`). Never add a proxy of ours.
- Diffusion providers: input prepared client-side (`ModelCapabilities.inputImage`: crop to ratio, multiples of 64), one random `seed` per job, provider options via `ModelCapabilities.options` + `job.providerOptions`.

- Gemini image generation = **Interactions API** `POST /v1beta/interactions` with `response_format: { type: "image", aspect_ratio?, image_size? }`. `mime_type` is NOT sent (the live API rejected `image/png` on 2026-09-11 despite the docs).
- Model capabilities live only in `GeminiModels.ts` (ids, aspect ratios, sizes). Verified 2026-09-11.
- Secrets: OS keychain via `keyring` crate (desktop). Not Stronghold (needs a JS-supplied password). Mobile keystore = TODO, session-only meanwhile.
- OAuth: Desktop client + PKCE + loopback `127.0.0.1:<port>/callback` (Rust). The user picks the Cloud project billed via `x-goog-user-project`. Web = API key only.
- Storage layout: `projects/<id>/{project.json, original/, generations/, thumbnails/}`; `schemaVersion` + migrations; images are files, never inside JSON.
- Variations are independent jobs; the UI shows progressive results; retry only for retryable codes.
- Hash router (`#/project/:id`, `#/settings/:section`, `#/recipes`); zustand stores; no react-router.
- **Post on Vinted = pre-fill, never publish** (desktop only). A second `WebviewWindow` with an isolated profile and a navigation allow-list; vinted.com never gets Tauri IPC; the script is compiled into the binary and only fills title, description and photos. DOM selectors live in one file (`src/infrastructure/publish/vinted/selectors.ts`). Vinted's terms forbid automated tools → one-time warning (`vintedAutomationAcknowledged`). Photos to post = the “À publier” marks (`ProjectDocument.toPost`, schema v2). Window-creating commands must be `async` (WebView2 deadlock in sync commands on Windows).
- **Mobile builds**: `keyring` is a desktop-only dependency (keyring 4 refuses to compile without `v1`/`cli`, and `secrets.rs` has no mobile keychain yet). Android builds on Windows need Developer Mode (cargo-mobile2 symlinks the `.so` into `jniLibs`, no copy fallback) — never build from an elevated terminal instead. `src-tauri/gen/android` is committed; the bundle identifier (`com.aiimagevariations.app`, Tauri warns about `.app`) is kept until a data migration exists (BUILDING.md §6).

## Out of scope (MVP)

Accounts, cloud sync, collaboration, sharing, marketplace, chat UI, payment, backend, ad SDK (only the `Entitlement` model exists).

## Toolchain pins

pnpm 10 · Node 22+ · TypeScript 6 · Vite 8 (rolldown; `minify: "esbuild"` is unsupported) · Vitest 4 · React 19 · Tailwind 4 · Tauri 2.11 · Rust 1.88+ · keyring 4.
