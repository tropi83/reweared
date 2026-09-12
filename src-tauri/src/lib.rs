mod oauth;
mod secrets;
mod vinted;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(oauth::LoopbackState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
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
