//! Secure credential storage backed by the operating system credential store.
//!
//! Only a closed set of keys is accepted (mirrored in `src/infrastructure/auth/SecretStore.ts`),
//! so the webview cannot use these commands as a general-purpose keychain API.
//! Values are never logged.

/// The API session of the desktop app (the account version keeps no provider credential on the device).
const ALLOWED_KEYS: &[&str] = &["session_token"];

/// Provider credentials the bring-your-own-key releases kept in the keychain. They are only ever deleted.
const LEGACY_KEYS: &[&str] = &["gemini_api_key", "google_oauth", "cloudflare_api_token", "cloudflare_worker_secret"];

fn check_key(key: &str) -> Result<(), String> {
    if ALLOWED_KEYS.contains(&key) {
        Ok(())
    } else {
        Err("unknown secret key".to_string())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod native {
    use super::{check_key, LEGACY_KEYS};
    use keyring::v1::{Entry, Error};

    const SERVICE: &str = "com.aiimagevariations.app";

    fn entry(key: &str) -> Result<Entry, String> {
        check_key(key)?;
        Entry::new(SERVICE, key).map_err(|e| format!("credential store unavailable: {e}"))
    }

    /// Deletes what the bring-your-own-key releases stored; missing entries are not an error.
    pub fn purge_legacy() -> Result<usize, String> {
        let mut removed = 0;
        for key in LEGACY_KEYS {
            let entry = Entry::new(SERVICE, key).map_err(|e| format!("credential store unavailable: {e}"))?;
            match entry.delete_credential() {
                Ok(()) => removed += 1,
                Err(Error::NoEntry) => {}
                Err(e) => return Err(format!("credential store delete failed: {e}")),
            }
        }
        Ok(removed)
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
    pub fn purge_legacy() -> Result<usize, String> {
        Ok(0)
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

/// Removes the provider credentials of the bring-your-own-key releases (run once at startup); returns how many.
#[tauri::command]
pub fn secret_purge_legacy() -> Result<usize, String> {
    native::purge_legacy()
}

#[cfg(test)]
mod tests {
    use super::{check_key, LEGACY_KEYS};

    #[test]
    fn only_the_session_token_can_be_read_or_written() {
        assert!(check_key("session_token").is_ok());
        for key in LEGACY_KEYS {
            assert!(check_key(key).is_err(), "{key} must not be readable any more");
        }
        assert!(check_key("anything").is_err());
    }
}
