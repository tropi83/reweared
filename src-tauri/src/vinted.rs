//! Vinted publishing window: a second `WebviewWindow` on vinted.com with an isolated data
//! directory, a navigation allow-list and one-way script injection. vinted.com never gets Tauri
//! IPC (no capability targets this window); the app reads results back through
//! `eval_with_callback`. See SECURITY.md ("Vinted window").

use serde::{Deserialize, Serialize};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "vinted";
pub const MAIN: &str = "main";
const HOME: &str = "https://www.vinted.com/";
const ALLOWED_PATHS: &[&str] = &["/items/new", "/"];
const VINTED_TLDS: &[&str] = &[
    "com", "fr", "de", "es", "it", "nl", "be", "pl", "pt", "at", "lt", "cz", "sk", "lu", "hu", "ro", "se", "fi", "dk", "gr", "hr", "ie",
    "co.uk", "us",
];
const LOGIN_HOSTS: &[&str] = &["accounts.google.com", "www.facebook.com", "appleid.apple.com"];
const MAX_TITLE: usize = 100;
const MAX_DESCRIPTION: usize = 5000;
const MAX_PHOTOS: usize = 20;
const MAX_PHOTO_BYTES: usize = 4 * 1024 * 1024;
/// Fixed WKWebsiteDataStore identifier for the Vinted webview on macOS (>= 14) / iOS (>= 17), where
/// `data_directory` is ignored. Random but constant so the same store is reused and can be removed.
#[cfg(target_os = "macos")]
const DATA_STORE_ID: [u8; 16] = [
    0x7a, 0x1c, 0x53, 0x9e, 0xb4, 0x2d, 0x4f, 0x08, 0x9d, 0x61, 0xc0, 0x3b, 0x5e, 0x72, 0xa9, 0x14,
];
/// Built by `pnpm build:prefill` from src/infrastructure/publish/vinted/.
const PREFILL_SCRIPT: &str = include_str!("../scripts/vinted-prefill.js");

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefillPhoto {
    pub name: String,
    pub mime_type: String,
    pub data: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PrefillPayload {
    pub title: String,
    pub description: String,
    pub photos: Vec<PrefillPhoto>,
}

#[derive(Clone, Serialize)]
struct PageEvent {
    url: String,
}

/// Exact-host match against the known Vinted marketplaces (optionally prefixed with `www.`);
/// no suffix matching, so `vinted.fr.evil.com` is rejected.
pub fn is_vinted_host(host: &str) -> bool {
    let host = host.strip_prefix("www.").unwrap_or(host);
    VINTED_TLDS.iter().any(|tld| host == format!("vinted.{tld}"))
}

pub fn is_allowed_navigation(url: &url::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(host) => is_vinted_host(host) || LOGIN_HOSTS.contains(&host),
        None => false,
    }
}

fn target_url(path: &str) -> Result<String, String> {
    if ALLOWED_PATHS.contains(&path) {
        Ok(format!("https://www.vinted.com{path}"))
    } else {
        Err("path not allowed".to_string())
    }
}

fn validate_payload(p: &PrefillPayload) -> Result<(), String> {
    if p.title.chars().count() > MAX_TITLE {
        return Err("title too long".into());
    }
    if p.description.chars().count() > MAX_DESCRIPTION {
        return Err("description too long".into());
    }
    if p.photos.len() > MAX_PHOTOS {
        return Err("too many photos".into());
    }
    for photo in &p.photos {
        if !matches!(photo.mime_type.as_str(), "image/jpeg" | "image/png") {
            return Err("unsupported photo type".into());
        }
        if photo.name.is_empty() || photo.name.len() > 120 || photo.name.contains(['/', '\\', '\0']) || photo.name.contains("..") {
            return Err("invalid photo name".into());
        }
        // 4 base64 chars encode 3 bytes; reject before decoding anything.
        if photo.data.len() / 4 * 3 > MAX_PHOTO_BYTES {
            return Err("photo too large".into());
        }
    }
    Ok(())
}

/// `eval_with_callback` hands back the JSON serialisation of the expression's value; since the
/// expression is `JSON.stringify(...)`, the value is itself a JSON string (double-encoded).
fn parse_poll_result(raw: &str) -> Option<serde_json::Value> {
    let outer: serde_json::Value = serde_json::from_str(raw).ok()?;
    let inner = match outer {
        serde_json::Value::String(s) => serde_json::from_str::<serde_json::Value>(&s).ok()?,
        other => other,
    };
    if inner.is_null() {
        None
    } else {
        Some(inner)
    }
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

#[tauri::command]
pub fn vinted_open<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
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

#[tauri::command]
pub fn vinted_prefill<R: Runtime>(app: AppHandle<R>, payload: PrefillPayload) -> Result<(), String> {
    validate_payload(&payload)?;
    let window = app.get_webview_window(LABEL).ok_or("vinted window is not open")?;
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    // The bundle is idempotent; `run` stores its report on window.__aivPrefill.status.
    window
        .eval(format!("{PREFILL_SCRIPT}\n;window.__aivPrefill.run({json});"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vinted_poll<R: Runtime>(app: AppHandle<R>) -> Result<Option<serde_json::Value>, String> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(None);
    };
    let (tx, rx) = mpsc::channel::<String>();
    let tx = Mutex::new(Some(tx));
    window
        .eval_with_callback(
            "JSON.stringify((window.__aivPrefill && window.__aivPrefill.status) || null)",
            move |result| {
                if let Some(tx) = tx.lock().ok().and_then(|mut guard| guard.take()) {
                    let _ = tx.send(result);
                }
            },
        )
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
    fn navigation_allow_list() {
        assert!(is_allowed_navigation(&url::Url::parse("https://www.vinted.fr/items/new").unwrap()));
        assert!(is_allowed_navigation(&url::Url::parse("https://vinted.co.uk/").unwrap()));
        assert!(is_allowed_navigation(
            &url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap()
        ));
        assert!(!is_allowed_navigation(&url::Url::parse("http://www.vinted.fr/").unwrap()));
        assert!(!is_allowed_navigation(&url::Url::parse("https://vinted.fr.evil.com/").unwrap()));
        assert!(!is_allowed_navigation(&url::Url::parse("https://example.com/").unwrap()));
    }

    #[test]
    fn navigate_paths_are_closed() {
        assert_eq!(target_url("/items/new").unwrap(), "https://www.vinted.com/items/new");
        assert_eq!(target_url("/").unwrap(), "https://www.vinted.com/");
        assert!(target_url("/items/new?x=1").is_err());
        assert!(target_url("https://evil.com").is_err());
    }

    fn photo(bytes: usize) -> PrefillPhoto {
        PrefillPhoto {
            name: "a.jpg".into(),
            mime_type: "image/jpeg".into(),
            data: base64_of(bytes),
        }
    }
    fn base64_of(n: usize) -> String {
        // 4 base64 chars per 3 bytes
        "A".repeat(n.div_ceil(3) * 4)
    }

    #[test]
    fn payload_limits() {
        let ok = PrefillPayload {
            title: "t".into(),
            description: "d".into(),
            photos: vec![photo(10)],
        };
        assert!(validate_payload(&ok).is_ok());
        let long_title = PrefillPayload {
            title: "x".repeat(101),
            ..ok.clone()
        };
        assert!(validate_payload(&long_title).is_err());
        let bad_mime = PrefillPayload {
            photos: vec![PrefillPhoto {
                mime_type: "image/gif".into(),
                ..photo(10)
            }],
            ..ok.clone()
        };
        assert!(validate_payload(&bad_mime).is_err());
        let big = PrefillPayload {
            photos: vec![photo(4 * 1024 * 1024 + 1)],
            ..ok.clone()
        };
        assert!(validate_payload(&big).is_err());
        let too_many = PrefillPayload {
            photos: (0..21).map(|_| photo(1)).collect(),
            ..ok.clone()
        };
        assert!(validate_payload(&too_many).is_err());
        let bad_name = PrefillPayload {
            photos: vec![PrefillPhoto {
                name: "../x.jpg".into(),
                ..photo(1)
            }],
            ..ok
        };
        assert!(validate_payload(&bad_name).is_err());
    }

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
    fn poll_result_unwraps_double_encoded_json() {
        assert_eq!(parse_poll_result("null"), None);
        assert_eq!(parse_poll_result("\"null\""), None);
        let v = parse_poll_result("\"{\\\"pageOk\\\":true}\"").unwrap();
        assert_eq!(v["pageOk"], serde_json::Value::Bool(true));
        let direct = parse_poll_result("{\"pageOk\":false}").unwrap();
        assert_eq!(direct["pageOk"], serde_json::Value::Bool(false));
    }
}
