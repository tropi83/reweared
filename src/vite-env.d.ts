/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the AI Image Variations API (accounts, listings, generation): "/" (the default) for the web bundle served
   * on the API's own origin, the public https origin for the desktop and phone builds.
   */
  readonly VITE_API_ORIGIN?: string;
  /** Shown in Settings → About / Diagnostics. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
