# Architecture

> The app runs on accounts and a server ([ADR 0001](docs/adr/0001-backend-accounts-platform-keys.md), binding design [`docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md`](docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md)). The earlier local-first, bring-your-own-key release is kept unchanged on the **`byok` branch**; its architecture is described there.

## Principles

1. **The server owns the data and the provider keys.** Listings, photos, texts, credits and generations live in Postgres and a private S3 bucket; the platform's provider keys exist only in the worker. The apps hold a session, never a provider credential.
2. **One shared TypeScript core.** `@aiv/domain` (models, catalogue, shot plans, errors, retry) and `@aiv/contracts` (zod schemas of the API) are imported by the server and the apps; `@aiv/providers` (Cloudflare, Gemini adapters) by the worker.
3. **Rust only where the webview cannot do it safely**: the OS keychain (session token) and the Vinted window/screens.
4. **The Vinted pre-fill stays on the device** and never clicks Vinted's submit button.

## Overview

```
web app (Caddy, same origin) ─┐
desktop / phone apps (Tauri) ─┴─HTTPS─► caddy ──► api (Fastify: Better Auth, REST, SSE, uploads)
                                                    │  SQL        │ S3          │ BullMQ add / Redis streams
                                                    ▼             ▼             ▼
                                                 postgres    seaweedfs        redis ◄── worker × N ──► Cloudflare / Gemini
                                                                                          (holds the platform's provider keys)
```

## Layers

```
packages/domain/      @aiv/domain — pure models + services + lib (no React, no I/O, no DOM): Listing, ImageAsset, Generation,
                      GenerationJob, catalogue + shot plans, mannequin, listing-copy contract, publish rules, credits, errors, ids, retry
packages/contracts/   @aiv/contracts — zod schemas of every API body, response and SSE payload
packages/providers/   @aiv/providers — Cloudflare Workers AI and Gemini adapters, the host allowlist (`http.ts`); used by the worker
apps/server/          api.ts, worker.ts, migrate.ts (entrypoints); auth/, listings/, images/, generations/, queue/, worker/,
                      credits/, events/, maintenance/, settings/, recipes/, platform/, db/ (drizzle), storage/ (S3) — see DEVELOPMENT.md → Server
src/                  the app (web bundle + Tauri webview)
  infrastructure/
    api/              ApiClient (one origin, /api/ paths, cookies on the web, bearer in Tauri), session token, SSE over fetch, errors
    auth/             SecretStore (session_token only; OS keychain on desktop) and the startup purge of BYOK-era credentials
    storage/          StorageProvider (IndexedDB on the web, files under $APPDATA in Tauri): the device's settings, and the old
                      local listings read once by the import
    image/            validation (magic bytes), decoding, re-encoding non-web formats, export / ZIP
    platform/         PlatformCapabilities
    publish/          PublishBridge: TauriVintedBridge (desktop), MobileVintedBridge (phones), UnsupportedBridge (web); vinted/ = the script
  app/                composition root (services.ts), ports/ (ListingRepository → RemoteListingRepository, RemoteRunEngine), stores
                      (zustand), query/ (TanStack Query: credits, platform), live-updates (SSE), router, bootstrap, import-local
  features/           React UI: account, listings, workspace, generation, gallery, catalog, mannequin, settings, publish
  components/ui/      Button, Input/Textarea/Select/Switch, Dialog, Badge, Segmented, Toaster
  i18n/               en.ts (source), fr.ts (overrides)
src-tauri/
  src/secrets.rs      OS keychain commands (key set: session_token; a purge command for the BYOK-era keys)
  src/vinted.rs       isolated Vinted window (status bar + vinted.com webviews)
  capabilities/       default.json (fs scoped to $APPDATA, dialogs), mobile.json (Vinted screen), api.json (generated: HTTP to the API only)
  plugins/vinted-webview/  shared Vinted policy (Rust) + native screens (Kotlin, Swift) for phones
scripts/tauri.mjs     `pnpm tauri …`: generates the API permission and CSP (tauri-api-config.mjs) before dev/build
deploy/, compose*.yaml  Dockerfile (server, web), Caddyfile, the stack
```

Dependency direction in the app: `features → app → infrastructure → @aiv/domain / @aiv/contracts`. The domain imports nothing from the other layers; it is typechecked without the DOM lib and tested in a Node Vitest project, with an ESLint boundary.

## Domain model

```
Listing ─┬─ ImageAsset (kind: original | generation)
         ├─ Generation (sourceImageId, parentGenerationId, category, settings, jobIds, status)
         └─ GenerationJob (generationId, sourceImageId, index, shotId, status, attempt, resultImageId, error)
```

The API returns a listing as a `ListingDocument` (the shape the app always used): the listing, its images, its photo packs and their jobs, and the photos marked "to post". Copy runs are jobs too but are not part of the document; their result is `Listing.copy`.

## Listing catalogue and packs

`packages/domain/src/services/catalog.ts` holds the marketplace taxonomy (10 categories → 56 subcategories) and, per product kind, a plan of shots: four base shots plus a mirror selfie for wearable kinds (not for kids). Every prompt shares a fidelity preamble and a quality suffix; `{{subject}}` and `{{wearer}}` come from the subcategory and the category. The seller's mannequin (build, pose, skin tone — a setting of the account) rewrites the wearer of the shots that show a person, never for kids and pets. The brand is never put in an image prompt. **The server plans the packs** (`apps/server/src/generations/plan.ts`) from the listing's category, its mannequin choice and the account's settings; the app only says which shots (the whole pack by default, one shot for "generate this photo again").

`packages/domain/src/services/listing-copy.ts` defines the listing-copy contract (photo → title, description, condition, brand, colour, keywords), its prompt and parser; the worker runs it with the platform's text model and imposes the seller's brand verbatim.

## Runs (server)

A run is one Postgres transaction: listing locked, generation + one job per shot inserted `queued`, credits reserved through the ledger (402 writes nothing). After the commit a per-user dispatcher feeds BullMQ (one queue per provider, rate-limited) with at most `MAX_ACTIVE_JOBS_PER_USER` jobs; a reconciler closes the gap between commit and dispatch. The worker prepares the source with sharp (crop/resize per the model's capabilities, new seed per attempt), calls the provider, re-encodes the result like an upload and completes the job with `WHERE status = 'active'` — a cancelled or deleted job keeps nothing. Retryable errors back off; final failures and cancellations are refunded exactly once (`refund:<jobId>`). Every transition is published on the user's Redis stream and served as SSE. Deleting a pack (`DELETE /api/v1/generations/:id`) refunds and stops its unfinished jobs and removes its photos. Details: the design spec §4 and the `backend` skill.

## The app

| Piece        | Where                                                                                 | What it does                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API origin   | `app/api-origin.ts`                                                                   | `VITE_API_ORIGIN`: `/` (default; the web bundle on the API's origin, `pnpm dev` through the Vite proxy) or the public https origin (desktop and phone builds)                                                                           |
| `ApiClient`  | `infrastructure/api/`                                                                 | `/api/` paths on one origin; cookies on the web, `Authorization: Bearer` in Tauri (token from `set-auth-token`, kept in the keychain as `session_token`); responses parsed with `@aiv/contracts`; errors → `AppError`; 401 → signed out |
| Accounts     | `stores/account-store.ts`, `features/account/*`                                       | sign-up (verification email), sign-in, password reset (`/?token=…#/reset-password`), sign-out, deletion by emailed link; `AuthGate` shows the auth screens until a session exists                                                       |
| Listings     | `ports/listing-repository.ts` → `RemoteListingRepository`, `stores/listings-store.ts` | the open listing and the sidebar; edits are debounced and saved as PATCHes of the changed fields; photos through `/api/v1/images/:id?variant=thumb\|full` (object-URL LRU in `image-urls.ts`)                                           |
| Runs         | `ports/remote-run-engine.ts`, `generation-store`, `listing-setup-store`               | "Create the listing" saves pending edits, then starts the pack and the copy together; retry, cancel, regenerate one shot, delete a pack                                                                                                 |
| Live updates | `live-updates.ts`                                                                     | SSE over `fetch` with `Last-Event-ID` resume; an event about the open listing, or a reconnection, re-reads its document (no field patching); terminal job events refresh the sidebar and the balance                                    |
| Credits      | `query/credits.ts`, `CreditsBadge`, `CreditsSection`                                  | TanStack Query (`credits` with `staleTime: 0`, `platform`); the run's cost on the button, the `listing.needCredits` blocker                                                                                                             |
| Settings     | `stores/settings-store.ts`                                                            | the device keeps its copy (theme, language); the account's settings (`locale`, `theme`, `mannequin`, `vintedAutomationAcknowledged`, `defaultAspectRatio`) are read at sign-in and saved with `PUT`                                     |
| Import       | `import-local.ts`, `ImportLocalDialog`                                                | one-time, resumable copy of the listings a local-first release left on the device (original photo and details; generated photos are not copied)                                                                                         |
| Tauri        | `scripts/tauri.mjs`, `scripts/tauri-api-config.mjs`                                   | the generated `api` capability (`http:default` on `<origin>/api/*`) and CSP patch, required for every dev/build                                                                                                                         |

`listing-readiness.ts` is the pure helper behind "Create the listing" (`canCreate` and the first blocker: no photo, no category, not enough credits). Zustand holds what the user edits (open listing, setup, composer, settings, UI, Vinted session, toasts); TanStack Query holds fetched account data (credits, platform info) — see `.claude/skills/tanstack-query`.

## Image pipeline

In the app: `validateImageFile` (size cap, magic-byte sniffing) → GIF/BMP/AVIF re-encoded to PNG → upload. On the server: magic-byte sniffing again, sharp re-encode (upright, **EXIF/GPS stripped**), WebP thumbnail (512 px), private bucket under `u/<user>/l/<listing>/…`, bytes streamed by the api (no public or presigned URL). Generated photos go through the same re-encode. Originals are never modified after upload.

## Publishing on Vinted (desktop and phones)

`packages/domain/src/services/publish.ts` (pure) decides what can be posted (photos marked "To post" + title/description + a platform with a Vinted window), the order (original first, then generations by creation time, at most 20) and maps Vinted URLs to stages. `app/publish-payload.ts` downloads and re-encodes the marked photos (JPEG ≤ 2048 px, ≤ 4 MiB) and caps the copy at Vinted's limits. `app/stores/publish-store.ts` drives the session `closed → login | browsing → form → filled`, fed by page events and a 500 ms poll (Vinted is a single-page app); arriving on the form runs the fill by itself. A session is bound to its listing and to an epoch.

`infrastructure/publish/PublishBridge.ts` has two modes: **windowed** (desktop, `TauriVintedBridge` → `vinted_*` commands) and **delegated** (phones, `MobileVintedBridge` → the `vinted-webview` plugin's native screen, one `run` call); `UnsupportedBridge` (web) throws `PLATFORM_UNSUPPORTED`. The Vinted webview has its own profile and a navigation allow-list, never gets IPC, and receives the pre-fill script (built from `infrastructure/publish/vinted/`) through `eval`. The script attaches the photos and mounts paste icons next to the title and the description: text goes in on the user's tap.

## Routing

A tiny hash router (`app/router.ts`): `#/`, `#/listing/:id` (legacy `#/project/:id` accepted), `#/settings/:section`; `#/reset-password` is read once from the password-reset link.

## Platform capabilities

`getPlatform()` reports `filesystem`, `secureStorage`, `nativeShare`, `camera`, `nativeDialogs`, `isMobile`. Features check capabilities instead of sniffing user agents.

## Ads / entitlements

`Entitlement { adsEnabled, tier }` exists in the settings model; no ad SDK is integrated. An `AdProvider` implementation must never receive images or prompts.

## Phases

0 docs, workspace, domain package · 1 compose stack and api · 2 worker, queue, credits, SSE · 3 the apps on the API, import of local listings, removal of the local mode (all done; plans in `docs/superpowers/plans/`) · 4 production (plan: [`2026-10-12-backend-phase-4.md`](docs/superpowers/plans/2026-10-12-backend-phase-4.md)).

Not on the API yet: custom recipes and free prompts (the server's `/api/v1/recipes` exists; the app only runs the catalogue's packs).
