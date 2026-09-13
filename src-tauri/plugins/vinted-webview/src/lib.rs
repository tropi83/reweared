//! Post on Vinted from a phone. The app hands the native side one job — the sell form to pre-fill —
//! and gets a report back when the user leaves the Vinted screen (see the design spec
//! `docs/superpowers/specs/2026-09-13-vinted-mobile-webview-design.md`).
//!
//! The crate also owns the policy every Vinted webview applies (hosts, paths, payload limits, the
//! injected script), so the desktop window in the app and the native screens here never drift apart.
//! On desktop the two commands answer "unsupported": the desktop flow lives in the app's `vinted.rs`.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub mod policy;

#[cfg(mobile)]
mod mobile;

pub use policy::{PrefillPayload, PrefillPhoto, PREFILL_SCRIPT};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Payload(String),
    #[error("posting on Vinted from this platform is unsupported")]
    Unsupported,
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// What the native screen reports back: the injected script's status, or nothing when the user left
/// before the form was filled.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResponse {
    pub report: Option<serde_json::Value>,
}

/// Everything the native screen needs, computed here so the policy has a single source.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub home: String,
    pub sell_path: String,
    pub allowed_hosts: Vec<String>,
    pub script: String,
    pub payload: PrefillPayload,
}

impl RunRequest {
    pub fn new(payload: PrefillPayload) -> Result<Self> {
        policy::validate_payload(&payload).map_err(Error::Payload)?;
        Ok(Self {
            home: policy::HOME.to_string(),
            sell_path: policy::SELL_PATH.to_string(),
            allowed_hosts: policy::allowed_hosts(),
            script: PREFILL_SCRIPT.to_string(),
            payload,
        })
    }
}

#[cfg(mobile)]
#[tauri::command]
async fn run<R: Runtime>(app: tauri::AppHandle<R>, payload: PrefillPayload) -> Result<RunResponse> {
    let request = RunRequest::new(payload)?;
    mobile::run(&app, request)
}

#[cfg(not(mobile))]
#[tauri::command]
async fn run<R: Runtime>(_app: tauri::AppHandle<R>, payload: PrefillPayload) -> Result<RunResponse> {
    policy::validate_payload(&payload).map_err(Error::Payload)?;
    Err(Error::Unsupported)
}

#[cfg(mobile)]
#[tauri::command]
async fn clear_session<R: Runtime>(app: tauri::AppHandle<R>) -> Result<()> {
    mobile::clear_session(&app)
}

#[cfg(not(mobile))]
#[tauri::command]
async fn clear_session<R: Runtime>(_app: tauri::AppHandle<R>) -> Result<()> {
    Err(Error::Unsupported)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("vinted-webview")
        .invoke_handler(tauri::generate_handler![run, clear_session])
        .setup(|app, api| {
            #[cfg(mobile)]
            mobile::init(app, api)?;
            #[cfg(not(mobile))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_request_carries_the_policy_and_rejects_bad_payloads() {
        let ok = RunRequest::new(PrefillPayload {
            title: "t".into(),
            description: "d".into(),
            photos: vec![],
        })
        .unwrap();
        assert_eq!(ok.sell_path, "/items/new");
        assert_eq!(ok.home, "https://www.vinted.com/");
        assert!(ok.allowed_hosts.contains(&"www.vinted.fr".to_string()));
        assert!(ok.script.contains("__aivPrefill"));
        let json = serde_json::to_value(&ok).unwrap();
        assert!(json["allowedHosts"].is_array());
        assert!(json["sellPath"].is_string());

        let bad = RunRequest::new(PrefillPayload {
            title: "x".repeat(101),
            description: "d".into(),
            photos: vec![],
        });
        assert!(matches!(bad, Err(Error::Payload(_))));
    }
}
