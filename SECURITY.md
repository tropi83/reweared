# Security

> **Planned change ([ADR 0001](docs/adr/0001-backend-accounts-platform-keys.md)):** the app is moving to user accounts and a server that runs generations with the platform's provider keys. This document describes the **current, local-first release**; the server's threat model is summarized in [Planned: server](#planned-server-adr-0001) and will replace the client sections as the phases ship.

## Threat model

| Asset                                                           | Threats considered                                                      | Mitigations                                                                                                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini API key / OAuth tokens, Cloudflare token / Worker secret | extraction from disk, logs, crash reports, clipboard, devtools, backups | OS credential store on desktop; memory-only by default on web; redacting logger; never in diagnostics; never sent anywhere but the provider it belongs to                         |
| Images / prompts                                                | exfiltration, upload without consent                                    | only sent when the user launches a generation, directly to the configured provider; no analytics, no ad SDK                                                                       |
| Local files                                                     | path traversal, malformed/huge/spoofed files                            | ids validated by `assertSafeId` before any path is built; Tauri fs scope limited to `$APPDATA/**`; magic-byte MIME sniffing; 40 MB cap; decoding delegated to the browser decoder |
| Webview                                                         | XSS, injection, over-privileged IPC                                     | strict CSP, no `dangerouslySetInnerHTML`, closed set of Rust commands, capabilities with minimum permissions                                                                      |
| Network                                                         | contacting unexpected hosts                                             | allowlist in `http-client.ts` + Tauri `http` scope + CSP `connect-src`                                                                                                            |

## Credentials

- **Cloudflare:** the API token (direct mode) and the Worker shared secret live in the SecretStore like the Gemini key (OS keychain on desktop, memory or opt-in localStorage on web). Account ID and Worker URL are configuration, not secrets. Worker URLs must be `https`, without credentials or query strings; `allowHost()` refuses localhost/loopback. The Worker template validates every input against the model schema, caps bodies at 12 MB, only runs allowlisted models and compares the shared secret in constant time.

- **Desktop (Windows/macOS/Linux):** `keyring` crate → Windows Credential Manager / macOS Keychain / Secret Service. Rust commands `secret_get/set/delete` accept only `gemini_api_key`, `google_oauth`, `cloudflare_api_token` and `cloudflare_worker_secret` (`ALLOWED_KEYS` in `secrets.rs`).
- **Web:** memory by default. _Remember on this device_ writes to `localStorage` **only after the user acknowledges** the browser disclaimer. The UI never claims browser storage is secure.
- **Mobile:** secure storage is not integrated yet; credentials are session-only (the Rust command reports unsupported and the frontend degrades). Tracked for Phase 6.
- The API key is never displayed after saving (only its last 4 characters).
- OAuth: Authorization Code + PKCE (S256), `state` verification, loopback redirect on `127.0.0.1:<random port>` (Google's installed-app guidance). The Desktop OAuth client's "secret" is public build configuration per Google's model ("installed apps cannot keep secrets") and is never treated as a security boundary. Refresh tokens are stored only in the OS credential store.
- Tokens are revoked at Google on disconnect.

## Logging

All logging goes through `lib/logger.ts`, which redacts Google API keys, `ya29.` access tokens, `1//` refresh tokens, bearer headers and `key=/token=/authorization` patterns. Images and prompts are never logged. Diagnostics (Settings → Diagnostics) contain version, platform, provider/model ids, job counts and redacted events only.

## Tauri permissions (`src-tauri/capabilities/default.json`)

| Permission                                                                                                                                              | Why                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `core:default`, `core:window:allow-set-title`                                                                                                           | window basics                                                                                                  |
| `opener:allow-open-url` scoped to `accounts.google.com`, `aistudio.google.com`, `console.cloud.google.com`, `dash.cloudflare.com`, `github.com/tropi83` | OAuth consent, "get an API key", the Cloudflare dashboard and the Worker template open in the system browser   |
| `dialog:allow-open`, `dialog:allow-save`                                                                                                                | import picker, export save dialog                                                                              |
| `fs:*` listed + `fs:scope` = `$APPDATA`, `$APPDATA/**`                                                                                                  | project storage; paths picked through dialogs are added to the scope by the dialog plugin                      |
| `http:default` scoped to the four Google hosts, `api.cloudflare.com` and `*.workers.dev`                                                                | Gemini API, token/revoke/userinfo, project listing; Cloudflare Workers AI direct API and the user's own Worker |

**API builds only** (`VITE_API_ORIGIN`, backend phase 3): `src-tauri/capabilities/api.json`, generated by `scripts/tauri-api-config.mjs` (`pnpm tauri:api:dev` / `tauri:api:build`) and git-ignored, adds `http:default` scoped to `<origin>/api/*` — accounts, listings, photos, runs and the event stream of the platform's API, nothing else on that host. The origin must be `https` (`http` only for `localhost`, the dev stack). Without `VITE_API_ORIGIN` the file is removed and the build is the local app's. The `ApiClient` itself only builds URLs under `/api/` on that one origin; the session token it sends lives in the OS keychain (`session_token`, memory only on phones until the keystore lands) and the web build uses httpOnly cookies instead.

No shell, no process, no notification, no clipboard plugin. `dragDropEnabled: false` on the window so HTML5 drag-and-drop delivers `File` objects to the webview without a native file-path bridge.

### Vinted window (`vinted_*` commands)

| Command                                | Why it exists                                                                                                                     | Guard                                                                                                                                                                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vinted_open`                          | Opens a second window: a status bar (app page `vinted-bar.html`) above `https://www.vinted.com/`, so the user can log in and post | Two webviews (`vinted-bar`, `vinted`), no capability targets either ⇒ no IPC from vinted.com nor from the bar; the Vinted webview has an isolated `data_directory` (`vinted-webview/`) and a navigation allow-list (Vinted hosts + Google/Facebook/Apple login) |
| `vinted_navigate`                      | Jumps to the sell form                                                                                                            | Only `/items/new` and `/`                                                                                                                                                                                                                                       |
| `vinted_prefill`                       | Injects the script: photos attached, paste icons for title/description                                                            | Script compiled into the binary (`include_str!`); payload validated (100/5000 chars, ≤ 20 photos, ≤ 4 MiB each, JPEG/PNG, safe names); never logged                                                                                                             |
| `vinted_poll`                          | Reads the window's location (to detect the sell form) and the script's status back                                                | Read-only expression, 5 s timeout; the location is stripped to `scheme://host[:port]/path` in Rust like `vinted:page` (no OAuth `code`/`state`)                                                                                                                 |
| `vinted_status`                        | Shows the app's guidance (localized text) in the status bar above vinted.com                                                      | The text is evaluated into the bar webview as a JSON string literal (`window.__aivBar.set("…")`) — never into vinted.com; kept in Rust state so a reload of the bar shows it again                                                                              |
| `vinted_close`, `vinted_clear_session` | Close / erase the Vinted session                                                                                                  | Window open: `clear_all_browsing_data` then close. Window closed: the stored profile is removed without creating a webview (see below)                                                                                                                          |

Isolation of the Vinted profile per platform:

- **Windows / Linux:** WebView2 / WebKitGTK honour `data_directory` = `$APPDATA/vinted-webview/`. `vinted_clear_session` with the window closed deletes that directory (`remove_dir_all`, a missing directory counts as cleared).
- **macOS 14+ / iOS 17+:** WKWebView ignores `data_directory`; the window uses a dedicated `WKWebsiteDataStore` bound to a fixed identifier (`data_store_identifier`), and `vinted_clear_session` removes that store by identifier (`AppHandle::remove_data_store`) without opening a window.
- **macOS < 14:** custom data stores do not exist, so WebKit falls back to the default store — the Vinted session is then shared with the main window's web storage and cannot be erased in isolation (`clear_all_browsing_data` with the window open would also wipe the main window's storage). The app does not target these versions for the Vinted feature.

`vinted:page` events carry `scheme://host[:port]/path` only — never the query or fragment — so OAuth `code`/`state` parameters never reach the frontend or its logger.

Other guarantees:

- The injected script attaches the photos, mounts one paste icon next to the title and one next to the description — the text is written only when the user taps an icon (their gesture, not an automated fill) — and writes a status object `{ pageOk, title, description, photos }` (`ready` = icon waiting for a tap); it never clicks submit and never reads cookies, storage or credentials.
- `vinted_open` and `vinted_prefill` are `async` commands: building a webview window from a synchronous command deadlocks on Windows (WebView2), and the payload (up to 20 base64 photos) is deserialised off the UI thread.
- Destroying the main window closes the Vinted window (`on_window_event` in `lib.rs`): it is never left running without the app that drives it.
- The web inspector (devtools) exists on the Vinted window in debug builds only; release builds do not enable Tauri's `devtools` feature.

### Vinted screen on Android / iOS (`vinted-webview:default`, `src-tauri/capabilities/mobile.json`)

Phones cannot drive a second window from the app's JavaScript (the app's WebView is paused while another screen is in front), so the plugin `src-tauri/plugins/vinted-webview` opens a **native** screen and does the whole job itself. The capability is restricted to the `main` window on `android` / `iOS` and grants two commands:

| Command                         | Why it exists                                                                     | Guard                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vinted-webview\|run`           | Opens the Vinted screen with the listing (title, description, photos) to pre-fill | Payload validated in Rust with the desktop limits (`policy.rs`: 100/5000 chars, ≤ 20 photos, ≤ 4 MiB each, JPEG/PNG, safe names); the allow-list (Vinted marketplaces + the three login hosts, `https` only) is computed in Rust and enforced natively (`shouldOverrideUrlLoading` / `decidePolicyFor`); the script is the compiled bundle |
| `vinted-webview\|clear_session` | Erases the Vinted session kept by that screen (Settings → Publishing)             | Android: the cookies and storage of the dedicated WebView profile (`androidx.webkit` Profile API) are wiped — a profile cannot be deleted while a destroyed WebView is still attached to it; iOS 17+: the dedicated `WKWebsiteDataStore` is removed by identifier                                                                          |

- The native WebView / WKWebView has **no bridge object**: vinted.com cannot call into the app. The only channel is one-way — `evaluateJavascript` injects the script and reads its status back.
- The request (script + payload) never touches an Intent or a file: it lives in process memory for the lifetime of the screen and is dropped when the screen returns (Binder would reject it anyway — the payload can weigh tens of MB).
- The screen never clicks "Add"; closing it returns the last status report to the app, nothing else.
- **Older Android WebViews without the Profile API** share one cookie jar per process: `clear_session` then removes all cookies, storage and cache of the app process — harmless here (the app's own WebView keeps no session: local-first, OAuth runs in the system browser), and documented. **iOS < 17** uses the default `WKWebsiteDataStore` for the same reason as macOS < 14.
- The iOS half was written without a Mac and is marked untested until built (BUILDING.md).

## Content Security Policy (`src-tauri/tauri.conf.json`)

`default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'` (inline `style` attributes for dynamic sizes); `img-src 'self' blob: data:`; `connect-src` restricted to `ipc:`, `http://ipc.localhost`, the Google hosts (`generativelanguage`, `oauth2`, `www`, `cloudresourcemanager` `.googleapis.com`), `api.cloudflare.com` and `*.workers.dev`; `object-src 'none'`; `frame-ancestors 'none'`; `form-action 'none'`. API builds add the API origin to `connect-src` (`src-tauri/tauri.api.conf.json`, merged with `tauri --config`, generated with the capability above).

## Files

- Listing writes are atomic (`listing.json.tmp` → rename).
- Temporary payloads (prepared provider images, base64 bodies) live in memory only and are dropped after the burst of jobs.
- Cancelled jobs never write a result. `Settings → Storage → Remove orphaned files` deletes any image file not referenced by a project document.

## Planned: server (ADR 0001)

Not implemented yet — design §7 in [`docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md`](docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md). This section becomes the main threat model when phase 3 ships.

**Implemented in phase 2** (same status):

- Provider keys: Docker secrets mounted in the `worker` service only; the api's configuration has no provider variable (tested), and `scripts/check-compose.mjs` fails CI if any other service receives one. The worker reaches providers through the shared host allowlist.
- Jobs: BullMQ data is the job id only — prompts stay in Postgres, images in the private bucket, emails never leave the account tables. Credits are reserved in the transaction that creates the jobs (402 writes nothing), refunded once per failed or cancelled job (idempotency keys, row lock; concurrency-tested), and a nightly check reports any balance that differs from its ledger.
- Cancellation never persists a result; a duplicate delivery stores one result; a cancelled or failed job frees the user's slot. Per-user cap on active jobs (fairness) and a daily Cloudflare neuron budget (503 before anything is reserved).
- SSE: session checked before the stream opens, the user's own Redis stream only (tested), at most 3 streams per user, events carry ids and statuses — never a prompt or an image.
- Maintenance: orphaned image objects older than a day are deleted nightly; keys outside the storage layout are only reported.

**Implemented in phase 1** (in the repository and tested; not yet used by the shipped clients):

- Accounts: Better Auth 1.7, password hashing by its default scrypt, sign-in refused until the email is verified, rate limits stored in Redis (sign-in 5/min, sign-up 5/h, reset and verification 3/h, per client IP resolved by Fastify behind Caddy; a client-supplied IP header is always overwritten). Telemetry is off in the config and the api refuses to start when `BETTER_AUTH_TELEMETRY` is truthy (it enables telemetry on its own). Stored Google tokens are encrypted; `/get-access-token` and `/refresh-token` are disabled.
- Sessions: httpOnly, `SameSite=Lax` cookies (`Secure` and `__Secure-` on https) or bearer tokens; the session guard runs before the request body is read; a cookie-authenticated mutation from another `Origin` is refused.
- Account deletion only from a link emailed to the account and opened in the signed-in session (Better Auth would otherwise accept any session younger than a day); the user's rows cascade and their objects are deleted.
- Data: every query filters on the session user; another user's listing, image or recipe is a 404 on every route (tested route by route).
- Uploads: session checked before the body is read, magic-byte sniffing, 40 MB cap (45 MB at Caddy), 50 MP decode limit, sharp re-encode without EXIF/GPS/XMP/IPTC/ICC, object keys built from checked ids only. Images are streamed from a private bucket (no public or presigned storage URL) with `nosniff`.
- Logs: pino JSON, requests as method + path + IP (query strings dropped — verification links carry tokens), shared redaction of keys, tokens, cookies and passwords, masked email addresses.
- Containers: only Caddy publishes ports; Postgres, Redis (password) and SeaweedFS on an internal network without a route out; secrets as Docker secret files (`./secrets`, git-ignored; the directory is `0700` for its owner and the files `0644`, because Compose mounts `file:` secrets with the host permissions and several container users read them); read-only root filesystems, `no-new-privileges`, dropped capabilities for the api; the api runs as a non-root user. Caddy sets HSTS, CSP, `nosniff`, `no-referrer`.

| Asset                                       | Threats considered                                                  | Planned mitigations                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform provider keys (Cloudflare, Gemini) | theft from the database, env dumps, images, logs, a compromised api | Docker secrets mounted in the **worker only**; the api never calls a provider; egress allowlist; rotation by replacing the secret file                                         |
| Accounts and sessions                       | credential stuffing, session theft, CSRF                            | Better Auth hashing (scrypt), rate limits, email verification (Resend); httpOnly `Secure` `SameSite=Lax` cookies + Origin check (web); bearer token in the OS keychain (Tauri) |
| Listings, photos, generations               | cross-user access, leaking location metadata, public buckets        | every query scoped by the session user (404 otherwise); private bucket, bytes streamed by the api (no public or presigned storage URL); EXIF/GPS stripped at upload            |
| Credits / provider budget                   | double spending, refund replay, free-credit abuse                   | ledger with idempotency keys and `CHECK (balance >= 0)`; reservation in the enqueue transaction; per-user caps; provider budget guard                                          |
| Infrastructure                              | exposed databases, container escape, data loss                      | only Caddy publishes ports; non-root, read-only containers; no Docker socket; nightly off-site backups with restore drills                                                     |

Logging moves to pino with the same redaction rules as `src/lib/logger.ts`; prompts, images, full emails, tokens and verification links are never logged. The Tauri capabilities, CSP and `ALLOWED_HOSTS` shrink to the API origin in phase 3; the OAuth loopback and provider credential storage leave the client.

## Reporting

Open an issue with the redacted diagnostics export. Never paste an API key or token. Vulnerabilities: contact the maintainer privately (see `CONTRIBUTING.md`), not in a public issue.
