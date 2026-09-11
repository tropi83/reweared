//! Loopback redirect receiver for the Google OAuth "installed app" flow.
//!
//! Google recommends `http://127.0.0.1:<port>` redirects for desktop apps
//! (https://developers.google.com/identity/protocols/oauth2/native-app). The frontend builds the
//! authorization URL and opens the system browser; this module only receives the single redirect,
//! extracts `code`/`state`/`error` and replies with a static page. Nothing here talks to Google,
//! and the authorization code is handed to the webview exactly once.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallbackResult {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

struct Pending {
    rx: Mutex<Option<Receiver<CallbackResult>>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct LoopbackState(Mutex<HashMap<u16, Arc<Pending>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    pub port: u16,
}

const MAX_REQUEST_BYTES: usize = 8 * 1024;
const RESPONSE_BODY: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>AI Image Variations</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
div{text-align:center}h1{font-size:20px;font-weight:600}p{color:#aaa}</style></head>
<body><div><h1>You can return to AI Image Variations.</h1><p>This window can be closed.</p></div></body></html>"#;

fn respond(mut stream: TcpStream, status: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{}",
        RESPONSE_BODY.len(),
        RESPONSE_BODY
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Parses `GET /callback?code=...&state=... HTTP/1.1` into a CallbackResult.
fn parse_request(raw: &str) -> Option<CallbackResult> {
    let request_line = raw.lines().next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    if method != "GET" || !target.starts_with("/callback") {
        return None;
    }
    let parsed = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    let mut result = CallbackResult::default();
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "code" => result.code = Some(value.into_owned()),
            "state" => result.state = Some(value.into_owned()),
            "error" => result.error = Some(value.into_owned()),
            _ => {}
        }
    }
    Some(result)
}

fn serve(listener: TcpListener, cancelled: Arc<AtomicBool>, tx: std::sync::mpsc::Sender<CallbackResult>) {
    for incoming in listener.incoming() {
        if cancelled.load(Ordering::SeqCst) {
            return;
        }
        let Ok(mut stream) = incoming else { continue };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = vec![0u8; MAX_REQUEST_BYTES];
        let n = stream.read(&mut buf).unwrap_or(0);
        let raw = String::from_utf8_lossy(&buf[..n]);
        match parse_request(&raw) {
            Some(result) => {
                respond(stream, "200 OK");
                let _ = tx.send(result);
                return;
            }
            None => respond(stream, "404 Not Found"),
        }
    }
}

#[tauri::command]
pub fn oauth_loopback_start(state: State<'_, LoopbackState>) -> Result<StartResult, String> {
    let listener =
        TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).map_err(|e| format!("could not open loopback port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let cancelled = Arc::new(AtomicBool::new(false));
    let (tx, rx) = channel();
    let pending = Arc::new(Pending {
        rx: Mutex::new(Some(rx)),
        cancelled: cancelled.clone(),
    });
    state.0.lock().map_err(|_| "state poisoned")?.insert(port, pending);
    std::thread::spawn(move || serve(listener, cancelled, tx));
    Ok(StartResult { port })
}

#[tauri::command]
pub async fn oauth_loopback_wait(state: State<'_, LoopbackState>, port: u16, timeout_ms: u64) -> Result<CallbackResult, String> {
    let pending = state
        .0
        .lock()
        .map_err(|_| "state poisoned")?
        .get(&port)
        .cloned()
        .ok_or("unknown loopback port")?;
    let rx = pending.rx.lock().map_err(|_| "state poisoned")?.take().ok_or("already waited")?;
    let timeout = Duration::from_millis(timeout_ms.clamp(1_000, 15 * 60_000));
    let result = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(timeout))
        .await
        .map_err(|e| e.to_string())?;
    let _ = state.0.lock().map(|mut map| map.remove(&port));
    match result {
        Ok(callback) => Ok(callback),
        Err(RecvTimeoutError::Timeout) => Err("timeout".to_string()),
        Err(RecvTimeoutError::Disconnected) => Err("cancelled".to_string()),
    }
}

#[tauri::command]
pub fn oauth_loopback_cancel(state: State<'_, LoopbackState>, port: u16) -> Result<(), String> {
    let pending = state.0.lock().map_err(|_| "state poisoned")?.remove(&port);
    if let Some(pending) = pending {
        pending.cancelled.store(true, Ordering::SeqCst);
        // Wake the accept loop so the thread exits promptly.
        let _ = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), Duration::from_millis(200));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_request;

    #[test]
    fn parses_callback() {
        let r = parse_request("GET /callback?code=4%2Fabc&state=xyz HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        assert_eq!(r.code.as_deref(), Some("4/abc"));
        assert_eq!(r.state.as_deref(), Some("xyz"));
        assert!(r.error.is_none());
    }

    #[test]
    fn parses_error_and_rejects_other_paths() {
        let r = parse_request("GET /callback?error=access_denied HTTP/1.1\r\n").unwrap();
        assert_eq!(r.error.as_deref(), Some("access_denied"));
        assert!(parse_request("GET /favicon.ico HTTP/1.1\r\n").is_none());
        assert!(parse_request("POST /callback HTTP/1.1\r\n").is_none());
    }
}
