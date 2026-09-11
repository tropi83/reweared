import { AppError, type AuthStatus, type CredentialKind } from "@/domain/models";
import { getPlatform, isTauri } from "@/infrastructure/platform/capabilities";
import { ApiKeyCredentialProvider } from "./ApiKeyCredentialProvider";
import type { CredentialProvider } from "./CredentialProvider";
import { GoogleOAuthCredentialProvider, getOAuthClientConfig } from "./GoogleOAuthCredentialProvider";
import { createSecretStore, type LayeredSecretStore } from "./SecretStore";
import { TauriLoopbackListener } from "./TauriLoopbackListener";

const MODE_KEY = "aiv.auth.mode";

/**
 * Owns the credential providers for Gemini and remembers which one is active.
 * The active *mode* is not a secret and lives in localStorage; the credentials themselves
 * live in the SecretStore.
 */
export class GeminiAuthManager {
  readonly apiKey: ApiKeyCredentialProvider;
  readonly oauth: GoogleOAuthCredentialProvider;
  private mode: CredentialKind;
  private readonly listeners = new Set<() => void>();

  constructor(secrets: LayeredSecretStore = createSecretStore()) {
    this.apiKey = new ApiKeyCredentialProvider(secrets);
    const platform = getPlatform();
    this.oauth = new GoogleOAuthCredentialProvider(
      secrets,
      getOAuthClientConfig(),
      isTauri() && platform.oauthBrowserFlow ? new TauriLoopbackListener() : null,
    );
    this.mode = readMode();
  }

  get activeKind(): CredentialKind {
    return this.mode;
  }

  get active(): CredentialProvider | null {
    if (this.mode === "api_key") return this.apiKey;
    if (this.mode === "oauth") return this.oauth;
    return null;
  }

  setActiveKind(kind: CredentialKind) {
    this.mode = kind;
    try {
      localStorage.setItem(MODE_KEY, kind);
    } catch {
      /* ignore */
    }
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((l) => l());
  }

  /** Picks the mode automatically on startup when only one credential exists. */
  async autoDetect(): Promise<void> {
    if (this.mode !== "none") return;
    const [key, oauth] = await Promise.all([this.apiKey.getStatus(), this.oauth.getStatus()]);
    if (oauth.state === "authenticated") this.setActiveKind("oauth");
    else if (key.state === "authenticated") this.setActiveKind("api_key");
  }

  async getStatus(): Promise<AuthStatus> {
    const provider = this.active;
    if (!provider) return { state: "unauthenticated", kind: "none" };
    return provider.getStatus();
  }

  async getRequestHeaders(): Promise<Record<string, string>> {
    const provider = this.active;
    if (!provider) throw new AppError("AUTH_REQUIRED", "Connect Google Gemini in Settings.");
    return provider.getRequestHeaders();
  }

  /** Lets the Gemini provider report a rejected credential back to the manager. */
  onCredentialRejected(code: "INVALID_CREDENTIAL" | "AUTH_EXPIRED") {
    if (this.mode === "api_key") this.apiKey.markRejected();
    if (this.mode === "oauth" && code === "AUTH_EXPIRED") {
      void this.oauth.refresh().catch(() => undefined);
    }
    this.notify();
  }
}

function readMode(): CredentialKind {
  try {
    const value = localStorage.getItem(MODE_KEY);
    if (value === "api_key" || value === "oauth") return value;
  } catch {
    /* ignore */
  }
  return "none";
}
