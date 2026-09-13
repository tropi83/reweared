//! Bridge to the Kotlin / Swift halves: `run` blocks until the native Vinted screen closes.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Manager, Runtime,
};

use crate::{Result, RunRequest, RunResponse};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.aiimagevariations.vinted";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_vinted_webview);

pub struct VintedWebview<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime, C: DeserializeOwned>(app: &AppHandle<R>, api: PluginApi<R, C>) -> Result<()> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "VintedWebviewPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_vinted_webview)?;
    app.manage(VintedWebview(handle));
    Ok(())
}

/// The native call returns when the screen is dismissed; commands are `async`, so the wait never
/// sits on the UI thread.
pub fn run<R: Runtime>(app: &AppHandle<R>, request: RunRequest) -> Result<RunResponse> {
    let plugin = app.state::<VintedWebview<R>>();
    Ok(plugin.0.run_mobile_plugin::<RunResponse>("run", request)?)
}

pub fn clear_session<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let plugin = app.state::<VintedWebview<R>>();
    plugin.0.run_mobile_plugin::<serde_json::Value>("clearSession", ())?;
    Ok(())
}
