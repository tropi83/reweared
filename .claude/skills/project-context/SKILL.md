---
name: project-context
description: Use at the start of any task on AI Image Variations — product intent, architecture map, where things live, decisions already taken (Gemini Interactions API, keyring, OAuth loopback), and what is explicitly out of scope.
---

# Project context — AI Image Variations

## Product in one paragraph

Local-first workspace: import an image → prompt → N independent variations (jobs) → compare → pick → "use as source" / "more like this" → iterate, all persisted on the device. Gemini is the intelligence; the app is the workflow. BYOK (API key or Google OAuth). No account, no backend, no cloud.

## Map

| Concern                                                 | Where                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Domain models / errors                                  | `src/domain/models/*` (`AppError`, `GenerationErrorCode`)               |
| Job queue (concurrency, retry, cancel, timeout)         | `src/domain/services/generation-queue.ts`                               |
| Provider contract + request builder                     | `src/domain/services/image-provider.ts`                                 |
| Gemini adapter, models catalogue, error mapping         | `src/infrastructure/providers/gemini/*`                                 |
| Mock provider (dev/tests)                               | `src/infrastructure/providers/mock/MockImageProvider.ts`                |
| Credentials (API key, OAuth PKCE+loopback, SecretStore) | `src/infrastructure/auth/*`                                             |
| Storage (IndexedDB web / Tauri fs native), migrations   | `src/infrastructure/storage/*`                                          |
| Image validation/decoding/thumbnails/export             | `src/infrastructure/image/*`                                            |
| HTTP entry point + host allowlist                       | `src/infrastructure/http/http-client.ts`                                |
| Composition root + stores                               | `src/app/services.ts`, `src/app/stores/*`                               |
| UI by feature                                           | `src/features/{projects,workspace,generation,gallery,recipes,settings}` |
| i18n                                                    | `src/i18n/en.ts` (source), `fr.ts`                                      |
| Rust commands (keychain, OAuth loopback)                | `src-tauri/src/{secrets,oauth}.rs`                                      |
| Permissions / CSP                                       | `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`      |

## Decisions already taken (do not re-litigate without new facts)

- Gemini image generation = **Interactions API** `POST /v1beta/interactions` with `response_format: { type: "image", aspect_ratio?, image_size? }`. `mime_type` is NOT sent (the live API rejected `image/png` on 2026-09-11 despite the docs).
- Model capabilities live only in `GeminiModels.ts` (ids, aspect ratios, sizes). Verified 2026-09-11.
- Secrets: OS keychain via `keyring` crate (desktop). Not Stronghold (needs a JS-supplied password). Mobile keystore = TODO, session-only meanwhile.
- OAuth: Desktop client + PKCE + loopback `127.0.0.1:<port>/callback` (Rust). The user picks the Cloud project billed via `x-goog-user-project`. Web = API key only.
- Storage layout: `projects/<id>/{project.json, original/, generations/, thumbnails/}`; `schemaVersion` + migrations; images are files, never inside JSON.
- Variations are independent jobs; the UI shows progressive results; retry only for retryable codes.
- Hash router (`#/project/:id`, `#/settings/:section`, `#/recipes`); zustand stores; no react-router.

## Out of scope (MVP)

Accounts, cloud sync, collaboration, sharing, marketplace, chat UI, payment, backend, ad SDK (only the `Entitlement` model exists).

## Toolchain pins

pnpm 10 · Node 22+ · TypeScript 6 · Vite 8 (rolldown; `minify: "esbuild"` is unsupported) · Vitest 4 · React 19 · Tailwind 4 · Tauri 2.11 · Rust 1.88+ · keyring 4.
