/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public OAuth client ID (Desktop app type) - not a secret per Google's installed-app model. */
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID_DESKTOP?: string;
  /**
   * Client "secret" issued with a Desktop-type OAuth client. Google states installed apps cannot
   * keep secrets; it is therefore treated as public build configuration, never as a security
   * boundary. Google's token endpoint requires it for Desktop clients.
   */
  readonly VITE_GOOGLE_OAUTH_CLIENT_SECRET_DESKTOP?: string;
  /** Enables the Mock provider in the UI (default: enabled in dev builds). */
  readonly VITE_ENABLE_MOCK_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
