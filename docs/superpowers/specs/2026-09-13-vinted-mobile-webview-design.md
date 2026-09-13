# Post on Vinted from Android and iOS — design

Approved in chat on 2026-09-13: native plugin (Kotlin + Swift), iOS written but untested here (no Mac).

## 1. Why a native plugin, and why the flow changes

Desktop opens a second Tauri `WebviewWindow` and drives it step by step from the app's JavaScript
(open → navigate → prefill → poll). On a phone the Vinted screen covers the app: the OS pauses the app's
WebView, its timers stop, so a JavaScript-driven loop cannot run. The mobile flow is **delegated**: the app
hands the whole job to the native side in one call and gets a report back when the user leaves the screen.

Tauri 2.11 also offers mobile multi-window (`activity_name`, iOS scenes); rejected: session isolation is not
guaranteed, the iOS scene replaces the app's UI, and the orchestration would still have to move to Rust.

## 2. Pieces

### `src-tauri/plugins/vinted-webview` — crate `tauri-plugin-vinted-webview`

- `src/policy.rs` — **single source of truth** shared with desktop `vinted.rs`: `VINTED_TLDS`, `LOGIN_HOSTS`,
  `ALLOWED_PATHS`, `SELL_PATH`, `is_vinted_host`, `is_allowed_navigation`, `target_url`, `PrefillPayload`
  - `validate_payload` (limits 100 / 5000 / 20 photos / 4 MB), `PREFILL_SCRIPT` (`include_str!` of
    `src-tauri/scripts/vinted-prefill.js`), `allowed_hosts()`.
- `src/lib.rs` — `init()` registers the plugin `vinted-webview` with commands `run` and `clear_session`.
  Mobile: `run` validates the payload then calls the native `run` with
  `{ script, payload, allowedHosts, allowedTlds, loginHosts, sellPath }` and returns `{ report: FillReport | null }`.
  Desktop: both commands answer "unsupported" (desktop keeps `vinted.rs`). The app registers the plugin
  only under `#[cfg(mobile)]`.
- `permissions/default.toml` — `allow-run`, `allow-clear-session`. Capability `capabilities/mobile.json`
  (`platforms: ["android", "iOS"]`, window `main`) grants `vinted-webview:default`; justified in SECURITY.md.

### Android (`android/`, package `com.aiimagevariations.vinted`)

- `VintedWebviewPlugin` (`@TauriPlugin`): `run` stores the request in an in-process holder (the payload can
  be tens of MB — never in Intent extras, Binder caps at ~1 MB) and starts `VintedActivity` with
  `startActivityForResult`; `@ActivityCallback` resolves with the report the activity returns; `clearSession`
  deletes the WebView profile (see below) or, without profile support, clears cookies / storage / cache.
- `VintedActivity` (AppCompat): toolbar with **Close** and a status line; a `WebView` with JavaScript and DOM
  storage on, file / content access off, no multiple windows, no geolocation. Navigation policy in
  `WebViewClient.shouldOverrideUrlLoading`: exact-host match on the Vinted marketplaces (+ the three login
  hosts) with the allowed paths — anything else is blocked (same rule as desktop). When a page under the sell
  path finishes loading and the form has not been filled yet, the activity injects the script and runs it with
  the payload, then polls `window.__aivPrefill.status` every 300 ms for up to 20 s; the status line shows the
  outcome. Back / Close return the last report (or none).
- **Session isolation**: with `androidx.webkit` `MULTI_PROFILE` (WebView 116+) the WebView uses a dedicated
  profile `vinted` (own cookies, storage, cache); `clear_session` wipes that profile's cookies and storage (deleting the profile fails while a destroyed WebView is still attached to it). Older WebViews share
  the process-wide cookie jar: `clear_session` then removes all cookies/storage/cache — acceptable because the
  app's own WebView holds nothing of value (local-first, OAuth runs in the system browser) — documented.

### iOS (`ios/`, Swift package)

- `VintedWebviewPlugin: Plugin`: `run` presents `VintedViewController` (navigation bar with Close; status
  line; `WKWebView`) modally over `manager.viewController`; resolves the invoke on dismiss. `clearSession`
  removes the dedicated `WKWebsiteDataStore(forIdentifier:)` on iOS 17+, or all website data of the default
  store below (documented limitation, same as macOS < 14 on desktop).
- `WKNavigationDelegate.decidePolicyFor` applies the allow-list; `didFinish` under the sell path injects and
  runs the script; polling with `evaluateJavaScript`. `WKWebViewConfiguration`: `websiteDataStore` dedicated
  (iOS 17+), `allowsInlineMediaPlayback`, no `javaScriptCanOpenWindowsAutomatically`.
- Written without a Mac: it follows the Kotlin implementation line by line and the official plugin
  conventions; BUILDING.md lists the verification to run on macOS (`pnpm ios:dev`).

### App side

- `PublishBridge` gains `mode: "windowed" | "delegated"` and, for delegated bridges, `run(payload)`.
  `MobileVintedBridge` (`plugin:vinted-webview|run` / `clear_session`). `createPublishBridge` returns it on
  mobile; web stays `UnsupportedBridge`.
- `canPost(doc, { supported })` — the blocker becomes `unsupported` (web only); i18n updated.
- `publish-store.start()`: delegated → builds the payload, sets `{ stage: "browsing", busy: true }`, awaits
  `bridge.run`, then `{ stage: report ? "filled" : "closed", report }`. `focus/openForm/fill` are no-ops in
  delegated mode. `PublishPanel` shows a delegated variant: "Vinted is open on top of the app" while busy,
  then the report and Done. `finish()` unchanged.
- `vinted.rs` (desktop) imports policy and the script from the plugin crate; its own copies are deleted.

## 3. Security

- vinted.com never gets Tauri IPC: the native WebView is a plain WebView / WKWebView with no bridge object;
  the only outbound channel is `evaluateJavascript` for the script and its status.
- The allow-list and payload limits are the desktop ones, computed in Rust and passed to native at `run`.
- The payload leaves the device only to the Vinted form the user is looking at; nothing is stored natively
  (the holder is cleared when the activity ends).
- New permission `vinted-webview:default` is scoped to the `main` window on mobile platforms only.

## 4. Tests and verification

- Rust: policy unit tests move to the plugin crate (`cargo test -p tauri-plugin-vinted-webview`); the app's
  `vinted.rs` tests keep the window-specific ones.
- JS: `MobileVintedBridge` (fake IPC), `publish-store` delegated flow, `PostButton` / `PublishPanel` on
  mobile, `canPost` with `supported`.
- Android: `pnpm android:apk` compiles the plugin (Kotlin) with the app; the debug APK runs on the Pixel
  emulator: the screen opens on vinted.com, an external link is blocked, Close returns to the app with the
  panel state, Settings → Publishing → erase session works. Filling the real form needs a Vinted account (not
  available here); the injected script is the desktop one, already covered by its unit tests.
- iOS: not built here (documented).
