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

## Content Security Policy (`src-tauri/tauri.conf.json`)

`default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'` (inline `style` attributes for dynamic sizes); `img-src 'self' blob: data:`; `connect-src` restricted to `ipc:`, `http://ipc.localhost` and the Google hosts; `object-src 'none'`; `frame-ancestors 'none'`; `form-action 'none'`.

## Files

- Project writes are atomic (`project.json.tmp` → rename).
- Temporary payloads (prepared provider images, base64 bodies) live in memory only and are dropped after the burst of jobs.
- Cancelled jobs never write a result. `Settings → Storage → Remove orphaned files` deletes any image file not referenced by a project document.

## Reporting

Open an issue with the redacted diagnostics export. Never paste an API key or token.
