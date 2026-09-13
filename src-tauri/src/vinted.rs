//! Vinted publishing window: one window holding two webviews — a thin status bar at the top
//! (an app page, driven by `eval` only) and vinted.com below, with an isolated data directory, a
//! navigation allow-list and one-way script injection. Neither webview gets Tauri IPC (no
//! capability targets them); the app reads results back through `eval_with_callback`. See
//! SECURITY.md ("Vinted window").

use serde::Serialize;
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime, Webview, WebviewBuilder,
    WebviewUrl, Window, WindowEvent,
};
// Hosts, paths, payload limits and the injected script are shared with the mobile plugin.
use tauri_plugin_vinted_webview::policy::{is_allowed_navigation, target_url, validate_payload, HOME, PREFILL_SCRIPT};
use tauri_plugin_vinted_webview::PrefillPayload;

/// The window; also the label of the vinted.com webview inside it.
pub const LABEL: &str = "vinted";
/// The status bar webview (an app page: `vinted-bar.html`).
pub const BAR: &str = "vinted-bar";
pub const MAIN: &str = "main";
/// Height of the status bar, in logical pixels (matches the phone screens' status line).
const BAR_HEIGHT: f64 = 44.0;
const WINDOW_SIZE: (f64, f64) = (1100.0, 900.0);
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

/// Bar on top, Vinted below, both full width. Physical pixels so the two never overlap or leave a
/// gap on fractional scale factors.
fn layout<R: Runtime>(window: &Window<R>) -> Result<(), String> {
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let bar = (BAR_HEIGHT * scale).round() as u32;
    let page = size.height.saturating_sub(bar);
    for webview in window.webviews() {
        let (y, h) = match webview.label() {
            l if l == BAR => (0, bar),
            l if l == LABEL => (bar, page),
            _ => continue,
        };
        webview.set_position(PhysicalPosition::new(0, y)).map_err(|e| e.to_string())?;
        webview.set_size(PhysicalSize::new(size.width, h)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Last text pushed to the status bar: re-applied when the bar page (re)loads, since `eval` on a
/// page that has not run its script yet is lost.
#[derive(Default)]
pub struct BarText(Mutex<String>);

/// `window.__aivBar.set(<text>)` with the text as a JSON string literal: no way to break out of it.
fn bar_script(text: &str) -> String {
    format!(
        "window.__aivBar && window.__aivBar.set({});",
        serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into())
    )
}

fn page_webview<R: Runtime>(app: &AppHandle<R>) -> Result<Webview<R>, String> {
    app.get_webview(LABEL).ok_or_else(|| "vinted window is not open".to_string())
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("vinted-webview"))
        .map_err(|e| e.to_string())
}

/// Async on purpose: on Windows, building a webview from a synchronous command deadlocks
/// (WebView2 — see the `WebviewWindowBuilder::new` docs).
#[tauri::command]
pub async fn vinted_open<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_window(LABEL) {
        return window.set_focus().map_err(|e| e.to_string());
    }
    let window = Window::builder(&app, LABEL)
        .title("Vinted")
        .inner_size(WINDOW_SIZE.0, WINDOW_SIZE.1)
        .build()
        .map_err(|e| e.to_string())?;
    let closed = app.clone();
    let resized = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Destroyed => {
            let _ = closed.emit_to(MAIN, "vinted:closed", serde_json::json!({}));
        }
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            let _ = layout(&resized);
        }
        _ => {}
    });

    // The status bar: an app page with no capability (nothing to invoke); the text is pushed in by
    // `vinted_status` through `eval`.
    let bar = WebviewBuilder::new(BAR, WebviewUrl::App("vinted-bar.html".into())).on_page_load(|webview, payload| {
        if payload.event() != PageLoadEvent::Finished {
            return;
        }
        let text = webview.state::<BarText>().0.lock().map(|t| t.clone()).unwrap_or_default();
        let _ = webview.eval(bar_script(&text));
    });
    window
        .add_child(bar, LogicalPosition::new(0.0, 0.0), LogicalSize::new(WINDOW_SIZE.0, BAR_HEIGHT))
        .map_err(|e| e.to_string())?;

    let main = app.clone();
    let page = WebviewBuilder::new(
        LABEL,
        WebviewUrl::External(HOME.parse().map_err(|e: url::ParseError| e.to_string())?),
    )
    .data_directory(data_dir(&app)?);
    // WKWebView ignores `data_directory`; isolate through a dedicated data store instead.
    #[cfg(target_os = "macos")]
    let page = page.data_store_identifier(DATA_STORE_ID);
    let page = page.on_navigation(is_allowed_navigation).on_page_load(move |_, payload| {
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
    });
    window
        .add_child(
            page,
            LogicalPosition::new(0.0, BAR_HEIGHT),
            LogicalSize::new(WINDOW_SIZE.0, WINDOW_SIZE.1 - BAR_HEIGHT),
        )
        .map_err(|e| e.to_string())?;
    layout(&window)
}

#[tauri::command]
pub fn vinted_navigate<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let page = page_webview(&app)?;
    let url = target_url(&path)?.parse::<url::Url>().map_err(|e| e.to_string())?;
    page.navigate(url).map_err(|e| e.to_string())?;
    page.window().set_focus().map_err(|e| e.to_string())
}

/// Shows `text` in the status bar above vinted.com (the app decides the wording, localized).
#[tauri::command]
pub fn vinted_status<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    if let Ok(mut last) = app.state::<BarText>().0.lock() {
        last.clone_from(&text);
    }
    let Some(bar) = app.get_webview(BAR) else {
        return Ok(());
    };
    bar.eval(bar_script(&text)).map_err(|e| e.to_string())
}

/// Async so that deserialising, validating and formatting up to 20 base64 photos never runs on the
/// main (UI) thread, where synchronous commands execute.
#[tauri::command]
pub async fn vinted_prefill<R: Runtime>(app: AppHandle<R>, payload: PrefillPayload) -> Result<(), String> {
    validate_payload(&payload)?;
    let page = page_webview(&app)?;
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    // The bundle is idempotent; `run` stores its report on window.__aivPrefill.status.
    page.eval(format!("{PREFILL_SCRIPT}\n;window.__aivPrefill.run({json});"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vinted_poll<R: Runtime>(app: AppHandle<R>) -> Result<Option<PollResult>, String> {
    let Some(page) = app.get_webview(LABEL) else {
        return Ok(None);
    };
    let (tx, rx) = mpsc::channel::<String>();
    let tx = Mutex::new(Some(tx));
    page.eval_with_callback(POLL_EXPRESSION, move |result| {
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
    if let Some(window) = app.get_window(LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Erases the Vinted session. With the window open, the live webview clears its own data and
/// closes; otherwise the stored profile is removed without ever creating a webview (no window
/// flash, no spurious `vinted:closed`).
#[tauri::command]
pub async fn vinted_clear_session<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(page) = app.get_webview(LABEL) {
        page.clear_all_browsing_data().map_err(|e| e.to_string())?;
        return page.window().close().map_err(|e| e.to_string());
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
    fn bar_script_quotes_the_text_as_a_json_literal() {
        assert_eq!(bar_script("Photos 2/3"), "window.__aivBar && window.__aivBar.set(\"Photos 2/3\");");
        // Quotes, tags and line breaks stay inside the string literal.
        let js = bar_script("a\"b</script>\n<img onerror=x>");
        assert_eq!(js, "window.__aivBar && window.__aivBar.set(\"a\\\"b</script>\\n<img onerror=x>\");");
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
