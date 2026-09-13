# Security

## Threat model

| Asset                         | Threats considered                                                      | Mitigations                                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini API key / OAuth tokens | extraction from disk, logs, crash reports, clipboard, devtools, backups | OS credential store on desktop; memory-only by default on web; redacting logger; never in diagnostics; never sent anywhere but Google                                             |
| Images / prompts              | exfiltration, upload without consent                                    | only sent when the user launches a generation, directly to the configured provider; no analytics, no ad SDK                                                                       |
| Local files                   | path traversal, malformed/huge/spoofed files                            | ids validated by `assertSafeId` before any path is built; Tauri fs scope limited to `$APPDATA/**`; magic-byte MIME sniffing; 40 MB cap; decoding delegated to the browser decoder |
| Webview                       | XSS, injection, over-privileged IPC                                     | strict CSP, no `dangerouslySetInnerHTML`, closed set of Rust commands, capabilities with minimum permissions                                                                      |
| Network                       | contacting unexpected hosts                                             | allowlist in `http-client.ts` + Tauri `http` scope + CSP `connect-src`                                                                                                            |

## Credentials

- **Cloudflare:** the API token (direct mode) and the Worker shared secret live in the SecretStore like the Gemini key (OS keychain on desktop, memory or opt-in localStorage on web). Account ID and Worker URL are configuration, not secrets. Worker URLs must be `https`, without credentials or query strings; `allowHost()` refuses localhost/loopback. The Worker template validates every input against the model schema, caps bodies at 12 MB, only runs allowlisted models and compares the shared secret in constant time.

- **Desktop (Windows/macOS/Linux):** `keyring` crate → Windows Credential Manager / macOS Keychain / Secret Service. Rust commands `secret_get/set/delete` accept only `gemini_api_key` and `google_oauth`.
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

No shell, no process, no notification, no clipboard plugin. `dragDropEnabled: false` on the window so HTML5 drag-and-drop delivers `File` objects to the webview without a native file-path bridge.

### Vinted window (`vinted_*` commands)

| Command                                | Why it exists                                                                      | Guard                                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vinted_open`                          | Opens `https://www.vinted.com/` in a second window so the user can log in and post | Isolated `data_directory` (`vinted-webview/`), navigation allow-list (Vinted hosts + Google/Facebook/Apple login), no capability targets the window ⇒ no IPC from vinted.com |
| `vinted_navigate`                      | Jumps to the sell form                                                             | Only `/items/new` and `/`                                                                                                                                                    |
| `vinted_prefill`                       | Injects the script: photos attached, paste icons for title/description             | Script compiled into the binary (`include_str!`); payload validated (100/5000 chars, ≤ 20 photos, ≤ 4 MiB each, JPEG/PNG, safe names); never logged                          |
| `vinted_poll`                          | Reads the script's status back                                                     | Read-only expression, 5 s timeout                                                                                                                                            |
| `vinted_close`, `vinted_clear_session` | Close / erase the Vinted session                                                   | Window open: `clear_all_browsing_data` then close. Window closed: the stored profile is removed without creating a webview (see below)                                       |

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

`default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'` (inline `style` attributes for dynamic sizes); `img-src 'self' blob: data:`; `connect-src` restricted to `ipc:`, `http://ipc.localhost` and the Google hosts; `object-src 'none'`; `frame-ancestors 'none'`; `form-action 'none'`.

## Files

- Listing writes are atomic (`listing.json.tmp` → rename).
- Temporary payloads (prepared provider images, base64 bodies) live in memory only and are dropped after the burst of jobs.
- Cancelled jobs never write a result. `Settings → Storage → Remove orphaned files` deletes any image file not referenced by a project document.

## Reporting

Open an issue with the redacted diagnostics export. Never paste an API key or token.
