//! Vinted publishing window: a second `WebviewWindow` on vinted.com with an isolated data
//! directory, a navigation allow-list and one-way script injection. vinted.com never gets Tauri
//! IPC (no capability targets this window); the app reads results back through
//! `eval_with_callback`. See SECURITY.md ("Vinted window").

use serde::Serialize;
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent};
// Hosts, paths, payload limits and the injected script are shared with the mobile plugin.
use tauri_plugin_vinted_webview::policy::{is_allowed_navigation, target_url, validate_payload, HOME, PREFILL_SCRIPT};
use tauri_plugin_vinted_webview::PrefillPayload;

pub const LABEL: &str = "vinted";
pub const MAIN: &str = "main";
/// Fixed WKWebsiteDataStore identifier for the Vinted webview on macOS (>= 14), where
/// `data_directory` is ignored. Random but constant so the same store is reused and can be removed.
#[cfg(target_os = "macos")]
const DATA_STORE_ID: [u8; 16] = [
    0x7a, 0x1c, 0x53, 0x9e, 0xb4, 0x2d, 0x4f, 0x08, 0x9d, 0x61, 0xc0, 0x3b, 0x5e, 0x72, 0xa9, 0x14,
];

#[derive(Clone, Serialize)]
struct PageEvent {
    url: String,
}

/// What one `vinted_poll` reads from the window: where it is (`scheme://host[:port]/path`, like
/// `vinted:page`) and the script's status (`None` until the script has decided). Vinted is a
/// single-page app: reaching the sell form through its own menu fires no page-load event, so the
/// store follows the location through this poll.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PollResult {
    pub url: String,
    pub status: Option<serde_json::Value>,
}

const POLL_EXPRESSION: &str =
    "JSON.stringify({url: String(location.href), status: (window.__aivPrefill && window.__aivPrefill.status) || null})";

/// `eval_with_callback` hands back the JSON serialisation of the expression's value; since the
/// expression is `JSON.stringify(...)`, the value is itself a JSON string (double-encoded).
fn parse_poll_result(raw: &str) -> Option<PollResult> {
    let outer: serde_json::Value = serde_json::from_str(raw).ok()?;
    let inner = match outer {
        serde_json::Value::String(s) => serde_json::from_str::<serde_json::Value>(&s).ok()?,
        other => other,
    };
    let object = inner.as_object()?;
    // The location is stripped like page events: a login redirect may carry OAuth parameters.
    let url = object
        .get("url")
        .and_then(|u| u.as_str())
        .and_then(|u| url::Url::parse(u).ok())
        .map(|u| page_event_url(&u))
        .unwrap_or_default();
    let status = object.get("status").filter(|s| !s.is_null()).cloned();
    Some(PollResult { url, status })
}

/// `origin + path` only: OAuth redirects carry `code`/`state` in the query, which must never reach
/// the frontend (and its logger).
fn page_event_url(url: &url::Url) -> String {
    let mut out = format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default());
    if let Some(port) = url.port() {
        out.push(':');
        out.push_str(&port.to_string());
    }
    out.push_str(url.path());
    out
}

/// Deletes the on-disk webview profile; a missing directory counts as already cleared.
fn remove_dir_if_present(dir: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("vinted-webview"))
        .map_err(|e| e.to_string())
}

/// Async on purpose: on Windows, building a webview window from a synchronous command deadlocks
/// (WebView2 — see the `WebviewWindowBuilder::new` docs).
#[tauri::command]
pub async fn vinted_open<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return window.set_focus().map_err(|e| e.to_string());
    }
    let main = app.clone();
    let builder = WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::External(HOME.parse().map_err(|e: url::ParseError| e.to_string())?),
    )
    .title("Vinted")
    .inner_size(1100.0, 860.0)
    .data_directory(data_dir(&app)?);
    // WKWebView ignores `data_directory`; isolate through a dedicated data store instead.
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(DATA_STORE_ID);
    let window = builder
        .on_navigation(is_allowed_navigation)
        .on_page_load(move |_, payload| {
            // Fired for Started and Finished; the store only wants a loaded DOM, once per navigation.
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let _ = main.emit_to(
                MAIN,
                "vinted:page",
                PageEvent {
                    url: page_event_url(payload.url()),
                },
            );
        })
        .build()
        .map_err(|e| e.to_string())?;
    let closed = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let _ = closed.emit_to(MAIN, "vinted:closed", serde_json::json!({}));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn vinted_navigate<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let window = app.get_webview_window(LABEL).ok_or("vinted window is not open")?;
    let url = target_url(&path)?.parse::<url::Url>().map_err(|e| e.to_string())?;
    window.navigate(url).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// Async so that deserialising, validating and formatting up to 20 base64 photos never runs on the
/// main (UI) thread, where synchronous commands execute.
#[tauri::command]
pub async fn vinted_prefill<R: Runtime>(app: AppHandle<R>, payload: PrefillPayload) -> Result<(), String> {
    validate_payload(&payload)?;
    let window = app.get_webview_window(LABEL).ok_or("vinted window is not open")?;
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    // The bundle is idempotent; `run` stores its report on window.__aivPrefill.status.
    window
        .eval(format!("{PREFILL_SCRIPT}\n;window.__aivPrefill.run({json});"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vinted_poll<R: Runtime>(app: AppHandle<R>) -> Result<Option<PollResult>, String> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(None);
    };
    let (tx, rx) = mpsc::channel::<String>();
    let tx = Mutex::new(Some(tx));
    window
        .eval_with_callback(POLL_EXPRESSION, move |result| {
            if let Some(tx) = tx.lock().ok().and_then(|mut guard| guard.take()) {
                let _ = tx.send(result);
            }
        })
        .map_err(|e| e.to_string())?;
    let raw = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(5)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "poll timed out".to_string())?;
    Ok(parse_poll_result(&raw))
}

#[tauri::command]
pub fn vinted_close<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Erases the Vinted session. With the window open, the live webview clears its own data and
/// closes; otherwise the stored profile is removed without ever creating a webview (no window
/// flash, no spurious `vinted:closed`).
#[tauri::command]
pub async fn vinted_clear_session<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.clear_all_browsing_data().map_err(|e| e.to_string())?;
        return window.close().map_err(|e| e.to_string());
    }
    // Windows / Linux: the WebView2 / WebKitGTK profile lives in `data_directory`.
    remove_dir_if_present(&data_dir(&app)?)?;
    // macOS >= 14: the profile is the WKWebsiteDataStore behind DATA_STORE_ID (the directory above
    // is never created there). Below macOS 14 the webview used the default store, which cannot be
    // erased in isolation — see SECURITY.md.
    #[cfg(target_os = "macos")]
    app.remove_data_store(DATA_STORE_ID).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_event_url_keeps_origin_and_path_only() {
        let u = url::Url::parse("https://www.vinted.fr/items/new?ref=1#x").unwrap();
        assert_eq!(page_event_url(&u), "https://www.vinted.fr/items/new");
        let oauth = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth?code=SECRET&state=s").unwrap();
        assert_eq!(page_event_url(&oauth), "https://accounts.google.com/o/oauth2/v2/auth");
        let port = url::Url::parse("https://www.vinted.com:8443/").unwrap();
        assert_eq!(page_event_url(&port), "https://www.vinted.com:8443/");
    }

    #[test]
    fn remove_dir_if_present_deletes_and_tolerates_missing() {
        let dir = std::env::temp_dir().join(format!("aiv-vinted-webview-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("nested")).unwrap();
        std::fs::write(dir.join("nested").join("cookies"), b"x").unwrap();
        assert!(remove_dir_if_present(&dir).is_ok());
        assert!(!dir.exists());
        assert!(remove_dir_if_present(&dir).is_ok());
    }

    #[test]
    fn poll_result_unwraps_double_encoded_json_and_strips_the_url() {
        assert_eq!(parse_poll_result("null"), None);
        assert_eq!(parse_poll_result("\"null\""), None);
        assert_eq!(parse_poll_result("\"oops"), None);
        // Double-encoded (the expression is JSON.stringify): status present.
        let raw = serde_json::to_string(r#"{"url":"https://www.vinted.fr/items/new?ref=1#x","status":{"pageOk":true}}"#).unwrap();
        let v = parse_poll_result(&raw).unwrap();
        assert_eq!(v.url, "https://www.vinted.fr/items/new");
        assert_eq!(v.status.unwrap()["pageOk"], serde_json::Value::Bool(true));
        // Direct object, no status yet (script not injected or still waiting for the form).
        let v = parse_poll_result(r#"{"url":"https://accounts.google.com/o/oauth2/v2/auth?code=SECRET","status":null}"#).unwrap();
        assert_eq!(
            v,
            PollResult {
                url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
                status: None
            }
        );
        // Unparsable location: empty url, never a panic.
        let v = parse_poll_result(r#"{"url":"about:blank#","status":null}"#).unwrap();
        assert_eq!(v.url, "about://blank");
        assert_eq!(parse_poll_result(r#"{"url":42}"#).unwrap().url, "");
        assert_eq!(parse_poll_result("[]"), None);
    }
}
