# Architecture

## Principles

1. **No proprietary backend.** The only network calls are from the user's device to Google (`generativelanguage.googleapis.com`, OAuth endpoints, Cloud Resource Manager for project listing). See `src/infrastructure/http/http-client.ts` for the host allowlist.
2. **Local-first.** Metadata is JSON, images are files. Everything is recoverable without the app.
3. **Shared TypeScript core.** Rust is only used for capabilities the webview cannot provide safely (OS keychain, loopback OAuth listener). Product logic lives in `src/`.
4. **Provider abstraction.** The domain never sees HTTP details.

## Layers

```
src/
  domain/            pure models + services (no React, no I/O)
    models/          Project, ImageAsset, Generation, GenerationJob, Recipe, ModelInfo, AppSettings, errors
    services/        GenerationQueue (job state machine), ImageProvider contract, recipe interpolation
  infrastructure/    I/O implementations
    storage/         StorageProvider: IndexedDbStorage (web), TauriFsStorage (native), migrations
    providers/       gemini/ (Interactions API adapter), mock/
    auth/            CredentialProvider: ApiKey, GoogleOAuth (PKCE + loopback), SecretStore, GeminiAuthManager
    image/           validation (magic bytes), decode (EXIF-upright), thumbnails, provider preparation, export/ZIP
    http/            single fetch entry point with host allowlist (browser fetch or Tauri http plugin)
    platform/        PlatformCapabilities
  app/               composition root (services), stores (zustand), router, bootstrap, theme, image URL cache
  features/          React UI by feature: projects, workspace, generation, gallery, recipes, settings
  components/ui/     Button, Input/Textarea/Select/Switch, Dialog, Badge, Segmented, Toaster
  i18n/              en.ts (source), fr.ts (overrides)
src-tauri/
  src/secrets.rs     OS keychain commands (closed key set)
  src/oauth.rs       loopback redirect receiver for the installed-app OAuth flow
  capabilities/      minimum permissions (fs scoped to $APPDATA, http scoped to Google hosts)
```

Dependency direction: `features → app → infrastructure → domain`. `domain` imports nothing from the other layers.

## Domain model

```
Project ─┬─ ImageAsset (kind: original | generation)
         ├─ Generation (sourceImageId, parentGenerationId, prompt, settings, jobIds, status)
         └─ GenerationJob (generationId, sourceImageId, index, status, attempt, resultImageId, error)
```

A `ProjectDocument` (`project.json`) holds all of a project's records plus `schemaVersion`/`appVersion`. `Generation.parentGenerationId` is the generation that produced `sourceImageId`; this is enough to rebuild the branch tree.

## Generation job system (`domain/services/generation-queue.ts`)

- `enqueue(jobs)` → `queued`; the pump starts up to `concurrency` jobs.
- A running job gets an `AbortController`; each attempt is wrapped in a timeout signal.
- Errors are normalized (`GenerationError`). Retryable codes (`RATE_LIMITED`, `NETWORK_ERROR`, `TIMEOUT`, `PROVIDER_UNAVAILABLE`) are retried with exponential backoff + full jitter, honouring `retryAfterMs`, up to `maxAttempts`. Non-retryable codes fail immediately.
- Cancellation aborts the request and the backoff sleep; a cancelled job never persists a result.
- Every transition is emitted through `onJobUpdate`; the app layer writes it into the project document (`applyJobUpdate`) and derives `Generation.status` (`active | completed | partial | failed | cancelled`).
- On project open, jobs left in `queued`/`generating` by a crash are marked failed (`Interrupted when the app closed`) — no ghost jobs.

The queue is pure TypeScript with injectable `sleep`/`random`, covered by `generation-queue.test.ts`.

## Providers

```ts
interface ImageProvider {
  info: ProviderInfo;
  getModels(): Promise<ModelInfo[]>;
  validateCredentials(): Promise<AuthStatus>;
  generate(request, { signal }): Promise<ImageGenerationResult>;
}
```

`ModelInfo.capabilities` (aspect ratios, image sizes, editing) is the single source of truth; `buildRequestForModel` strips unsupported parameters so nothing unsupported is ever sent. The UI only offers what the selected model supports.

### Gemini (`infrastructure/providers/gemini`)

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/interactions` with `{ model, input: [text, image], response_format: { type: "image", mime_type, aspect_ratio?, image_size? }, store: false }` (docs verified 2026-09-11).
- Result: first `type: "image"` content in a `model_output` step. No image → `NO_IMAGE_RETURNED` / `CONTENT_REJECTED`.
- Models catalogue in `GeminiModels.ts`; availability is refined from `GET /v1beta/models` when reachable.
- Auth headers come from `GeminiAuthManager` (`x-goog-api-key` or `Authorization: Bearer` + `x-goog-user-project`).
- Error normalization in `GeminiErrors.ts` (HTTP status + message → code, `Retry-After` → `retryAfterMs`).

### Quotas and usage

Google returns the same "You exceeded your current quota" sentence for throttling, daily exhaustion and models outside the plan; `GeminiErrors.parseQuotaInfo` reads the structured `google.rpc.QuotaFailure` / `RetryInfo` details to classify (`RATE_LIMITED` retryable with Google's delay · `QUOTA_EXCEEDED` · `MODEL_NOT_IN_PLAN` when `quotaValue` is 0). `domain/services/usage-tracker.ts` counts requests locally per provider/model (rolling minute, Pacific day), learns limits from those details (`quotaValue`) unless the user set manual ones, and persists through `StorageProvider.readMeta/writeMeta` (`metadata/usage.json` on desktop). Only requests from this device are counted; the UI states it.

### Cloudflare Workers AI (`infrastructure/providers/cloudflare`)

- `CloudflareAuth` resolves the endpoint: direct REST (`/accounts/{id}/ai/run/{model}`, bearer token; desktop only because the API has no CORS) or the user's Worker (`{workerUrl}/run/{model}`, optional bearer secret). Config in `metadata/cloudflare-config.json`, secrets in the SecretStore.
- `CloudflareMapper` builds the JSON body (`prompt`, `image_b64`, `width/height`, `num_steps`, `strength`, `guidance`, `negative_prompt`, `seed`) with options normalized into the documented ranges; the response is raw PNG bytes, a JSON body on 200 is treated as an envelope error.
- Diffusion models cannot change the aspect ratio and are deterministic: `ModelCapabilities.inputImage` makes `buildRequestForJob` crop/resize the source (multiples of 64) via `computeGeometry`, and each job carries a random `seed`. `ModelCapabilities.options` drives the composer's Advanced panel generically.
- `cloudflare-worker/` is the Worker template users deploy in their own account (AI binding, CORS, secret, input validation).

### Mock

Renders a tinted, labelled copy of the source on a canvas; scenarios: `success | slow | flaky | rate_limited | timeout | error | no_image`.

## Storage

```
<app data>/
  projects/<projectId>/
    project.json
    original/<assetId>.<ext>
    generations/<assetId>.<ext>
    thumbnails/<assetId>.webp
  recipes/<recipeId>.json
  settings.json
```

Web uses the same logical layout inside IndexedDB (`projects`, `images`, `recipes`, `settings` stores). `StorageProvider` is the only interface the app uses; SQLite can be added as another implementation. `migrations.ts` upgrades documents by `schemaVersion` (`CURRENT_SCHEMA_VERSION = 1`); newer documents are refused rather than silently rewritten.

Image bytes are never put in the JSON. Thumbnails (WebP, 512px) drive the gallery; full images are only loaded for fullscreen/export. Object URLs are cached in a bounded LRU (`app/image-urls.ts`).

## Image pipeline

`validateImageFile` (size cap, magic-byte MIME sniffing) → `decodeImage` (`createImageBitmap` with `imageOrientation: "from-image"`) → thumbnail → stored original (GIF/BMP/AVIF are re-encoded to PNG, PNG/JPEG/WebP kept as-is) → `prepareForProvider` (downscale to `prepareMaxDimension`, PNG/JPEG) at generation time, cached per source for the burst of N jobs. Originals are never modified.

## State

Zustand stores in `app/stores`: `projects` (current `ProjectDocument` + debounced atomic saves), `generation` (models, start/retry/cancel), `composer`, `auth`, `settings`, `recipes`, `ui` (selection, lightbox, filter), `toast`. `app/services.ts` is the composition root; tests build it with an in-memory IndexedDB.

## Routing

A tiny hash router (`app/router.ts`): `#/`, `#/project/:id`, `#/recipes`, `#/settings/:section`.

## Platform capabilities

`getPlatform()` reports `filesystem`, `secureStorage`, `oauthBrowserFlow`, `nativeShare`, `camera`, `nativeDialogs`. Features check capabilities instead of sniffing user agents.

## Ads / entitlements

`Entitlement { adsEnabled, tier }` exists in the settings model; no ad SDK is integrated. An `AdProvider` implementation must never receive images or prompts.
