export type PlatformKind = "web" | "windows" | "macos" | "linux" | "android" | "ios";

export interface PlatformCapabilities {
  kind: PlatformKind;
  isTauri: boolean;
  isMobile: boolean;
  /** Real filesystem storage via Tauri (otherwise IndexedDB). */
  filesystem: boolean;
  /** OS credential store available for secrets. */
  secureStorage: boolean;
  /** Browser-based OAuth with loopback redirect (desktop only). */
  oauthBrowserFlow: boolean;
  nativeShare: boolean;
  camera: boolean;
  nativeDialogs: boolean;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && !!window.__TAURI_INTERNALS__;
}

function detectKind(): PlatformKind {
  if (!isTauri()) return "web";
  const platform = import.meta.env.TAURI_ENV_PLATFORM as string | undefined;
  switch (platform) {
    case "windows":
      return "windows";
    case "darwin":
    case "macos":
      return "macos";
    case "linux":
      return "linux";
    case "android":
      return "android";
    case "ios":
      return "ios";
  }
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  return "linux";
}

let cached: PlatformCapabilities | undefined;

export function getPlatform(): PlatformCapabilities {
  if (cached) return cached;
  const kind = detectKind();
  const tauri = kind !== "web";
  const mobile = kind === "android" || kind === "ios";
  cached = {
    kind,
    isTauri: tauri,
    isMobile: mobile,
    filesystem: tauri,
    // Desktop uses the OS keychain through a Rust command; mobile keystore integration is a later phase.
    secureStorage: tauri && !mobile,
    oauthBrowserFlow: tauri && !mobile,
    nativeShare: mobile,
    camera: mobile || (typeof navigator !== "undefined" && !!navigator.mediaDevices),
    nativeDialogs: tauri,
  };
  return cached;
}

/** Test hook. */
export function __resetPlatformCache() {
  cached = undefined;
}
