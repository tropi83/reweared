mod oauth;
mod secrets;
mod vinted;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .manage(oauth::LoopbackState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init());
    // Phones post on Vinted through a native screen; desktop keeps its own window (vinted.rs).
    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_vinted_webview::init());
    }
    builder
        .on_window_event(|window, event| {
            // The Vinted window is only driven from the main one: never leave it orphaned (and keeping
            // the process alive) once the main window is gone.
            if window.label() == vinted::MAIN && matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = vinted::vinted_close(window.app_handle().clone());
            }
        })
        .invoke_handler(tauri::generate_handler![
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            oauth::oauth_loopback_start,
            oauth::oauth_loopback_wait,
            oauth::oauth_loopback_cancel,
            vinted::vinted_open,
            vinted::vinted_navigate,
            vinted::vinted_prefill,
            vinted::vinted_poll,
            vinted::vinted_close,
            vinted::vinted_clear_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
