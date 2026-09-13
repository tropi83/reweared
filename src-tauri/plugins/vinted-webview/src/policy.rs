//! The rules every Vinted webview obeys, on every platform: which hosts and paths may load, what a
//! pre-fill payload may contain, and the injected script itself. Desktop (`vinted.rs` in the app) and
//! the mobile plugin both read from here, so a change lands everywhere at once.

use serde::{Deserialize, Serialize};

pub const HOME: &str = "https://www.vinted.com/";
pub const SELL_PATH: &str = "/items/new";
pub const ALLOWED_PATHS: &[&str] = &[SELL_PATH, "/"];
pub const VINTED_TLDS: &[&str] = &[
    "com", "fr", "de", "es", "it", "nl", "be", "pl", "pt", "at", "lt", "cz", "sk", "lu", "hu", "ro", "se", "fi", "dk", "gr", "hr", "ie",
    "co.uk", "us",
];
pub const LOGIN_HOSTS: &[&str] = &["accounts.google.com", "www.facebook.com", "appleid.apple.com"];
pub const MAX_TITLE: usize = 100;
pub const MAX_DESCRIPTION: usize = 5000;
pub const MAX_PHOTOS: usize = 20;
pub const MAX_PHOTO_BYTES: usize = 4 * 1024 * 1024;
/// Built by `pnpm build:prefill` from src/infrastructure/publish/vinted/.
pub const PREFILL_SCRIPT: &str = include_str!("../../../scripts/vinted-prefill.js");

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

/// The exact host list handed to native webviews (they apply the same rule without a URL parser).
pub fn allowed_hosts() -> Vec<String> {
    VINTED_TLDS
        .iter()
        .flat_map(|tld| [format!("vinted.{tld}"), format!("www.vinted.{tld}")])
        .chain(LOGIN_HOSTS.iter().map(|h| h.to_string()))
        .collect()
}

pub fn target_url(path: &str) -> Result<String, String> {
    if ALLOWED_PATHS.contains(&path) {
        Ok(format!("https://www.vinted.com{path}"))
    } else {
        Err("path not allowed".to_string())
    }
}

pub fn validate_payload(p: &PrefillPayload) -> Result<(), String> {
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
    fn allowed_hosts_are_exact_and_cover_every_marketplace_and_login_host() {
        let hosts = allowed_hosts();
        assert!(hosts.contains(&"vinted.fr".to_string()));
        assert!(hosts.contains(&"www.vinted.co.uk".to_string()));
        assert!(hosts.contains(&"accounts.google.com".to_string()));
        assert_eq!(hosts.len(), VINTED_TLDS.len() * 2 + LOGIN_HOSTS.len());
        assert!(hosts.iter().all(|h| is_allowed_navigation(&url::Url::parse(&format!("https://{h}/")).unwrap())));
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
    fn the_injected_script_is_bundled() {
        assert!(PREFILL_SCRIPT.contains("__aivPrefill"));
    }
}
