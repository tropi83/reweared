//! Secure credential storage backed by the operating system credential store.
//!
//! Only a closed set of keys is accepted (mirrored in `src/infrastructure/auth/SecretStore.ts`),
//! so the webview cannot use these commands as a general-purpose keychain API.
//! Values are never logged.

const ALLOWED_KEYS: &[&str] = &["gemini_api_key", "google_oauth", "cloudflare_api_token", "cloudflare_worker_secret"];

fn check_key(key: &str) -> Result<(), String> {
    if ALLOWED_KEYS.contains(&key) {
        Ok(())
    } else {
        Err("unknown secret key".to_string())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod native {
    use super::check_key;
    use keyring::v1::{Entry, Error};

    const SERVICE: &str = "com.aiimagevariations.app";

    fn entry(key: &str) -> Result<Entry, String> {
        check_key(key)?;
        Entry::new(SERVICE, key).map_err(|e| format!("credential store unavailable: {e}"))
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("credential store read failed: {e}")),
        }
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        entry(key)?
            .set_password(value)
            .map_err(|e| format!("credential store write failed: {e}"))
    }

    pub fn delete(key: &str) -> Result<(), String> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("credential store delete failed: {e}")),
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod native {
    use super::check_key;

    // Mobile keystore integration is a later phase; the frontend falls back to session-only
    // credentials when these report "unsupported".
    pub fn get(key: &str) -> Result<Option<String>, String> {
        check_key(key)?;
        Ok(None)
    }
    pub fn set(key: &str, _value: &str) -> Result<(), String> {
        check_key(key)?;
        Err("secure storage is not available on this platform yet".to_string())
    }
    pub fn delete(key: &str) -> Result<(), String> {
        check_key(key)?;
        Ok(())
    }
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    native::get(&key)
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    if value.is_empty() || value.len() > 16 * 1024 {
        return Err("invalid secret value".to_string());
    }
    native::set(&key, &value)
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    native::delete(&key)
}
