import { AppError, type AuthStatus } from "@/domain/models";
import { httpFetch } from "@/infrastructure/http/http-client";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { createLogger } from "@/lib/logger";
import type { AuthResult, CredentialProvider } from "./CredentialProvider";
import { createCodeChallenge, createCodeVerifier, randomUrlSafeString } from "./pkce";
import type { LayeredSecretStore } from "./SecretStore";

const log = createLogger("oauth");

/**
 * Endpoints and scopes from Google's official documentation (verified 2026-09-11):
 * - https://developers.google.com/identity/protocols/oauth2/native-app
 * - https://ai.google.dev/gemini-api/docs/oauth
 */
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const PROJECTS_ENDPOINT = "https://cloudresourcemanager.googleapis.com/v1/projects";

export const GEMINI_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language.retriever",
  "openid",
  "email",
];

/** Persisted in the secret store as one JSON document. */
interface StoredOAuth {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  email?: string;
  /** Google Cloud project billed for usage (x-goog-user-project). */
  projectId?: string;
}

export interface OAuthClientConfig {
  clientId: string;
  /** Public per Google's installed-app model; required by the token endpoint for Desktop clients. */
  clientSecret?: string;
}

/** Abstracts how the authorization code comes back (Rust loopback server on desktop). */
export interface LoopbackListener {
  start(): Promise<{ port: number }>;
  waitForCallback(port: number, timeoutMs: number, signal?: AbortSignal): Promise<{ code?: string; state?: string; error?: string }>;
  cancel(port: number): Promise<void>;
}

export interface GoogleCloudProject {
  projectId: string;
  name: string;
}

export function getOAuthClientConfig(): OAuthClientConfig | null {
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID_DESKTOP?.trim();
  if (!clientId) return null;
  const clientSecret = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_SECRET_DESKTOP?.trim();
  return clientSecret ? { clientId, clientSecret } : { clientId };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class GoogleOAuthCredentialProvider implements CredentialProvider {
  readonly kind = "oauth" as const;
  private stored: StoredOAuth | null = null;
  private loading: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  private openBrowser: (url: string) => Promise<void>;

  constructor(
    private readonly secrets: LayeredSecretStore,
    private readonly config: OAuthClientConfig | null,
    private readonly loopback: LoopbackListener | null,
    openBrowser?: (url: string) => Promise<void>,
  ) {
    this.openBrowser =
      openBrowser ??
      (async (url) => {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      });
  }

  get isConfigured(): boolean {
    return this.config !== null;
  }

  get isSupported(): boolean {
    return this.loopback !== null && getPlatform().oauthBrowserFlow;
  }

  /** Loads once; concurrent callers share the same promise so none observes a half-loaded state. */
  private load(): Promise<void> {
    this.loading ??= (async () => {
      const raw = await this.secrets.get("google_oauth");
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as StoredOAuth;
        if (parsed.refreshToken && parsed.accessToken) this.stored = parsed;
      } catch {
        this.stored = null;
      }
    })();
    return this.loading;
  }

  private async persist(): Promise<void> {
    if (!this.stored) {
      await this.secrets.delete("google_oauth");
      return;
    }
    // OAuth tokens are only ever kept in a persistent store on platforms with a secure one.
    await this.secrets.set("google_oauth", JSON.stringify(this.stored), getPlatform().secureStorage);
  }

  /**
   * Authorization Code + PKCE with a loopback redirect. The user completes consent in their
   * system browser; nothing about the account is sent anywhere but Google.
   */
  async authenticate(input?: unknown): Promise<AuthResult> {
    const signal = (input as { signal?: AbortSignal } | undefined)?.signal;
    if (!this.config) throw new AppError("AUTH_REQUIRED", "Google sign-in is not configured in this build.");
    if (!this.loopback || !this.isSupported) {
      throw new AppError("AUTH_REQUIRED", "Google sign-in is only available in the desktop app.");
    }

    const verifier = createCodeVerifier();
    const challenge = await createCodeChallenge(verifier);
    const state = randomUrlSafeString(16);
    const { port } = await this.loopback.start();
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GEMINI_OAUTH_SCOPES.join(" "));
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    try {
      await this.openBrowser(url.toString());
      const callback = await this.loopback.waitForCallback(port, 5 * 60_000, signal);
      if (callback.error) {
        const cancelled = callback.error === "access_denied";
        throw new AppError(cancelled ? "CANCELLED" : "PERMISSION_DENIED", cancelled ? "Sign-in was cancelled." : "Google refused the authorization.", {
          detail: callback.error,
        });
      }
      if (!callback.code || callback.state !== state) {
        throw new AppError("INVALID_CREDENTIAL", "The sign-in response could not be verified.");
      }
      const token = await this.exchange({
        grant_type: "authorization_code",
        code: callback.code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
      if (!token.refresh_token || !token.access_token) {
        throw new AppError("INVALID_CREDENTIAL", "Google did not return a refresh token. Remove the app's access in your Google account and try again.");
      }
      this.loading = Promise.resolve();
      this.stored = {
        refreshToken: token.refresh_token,
        accessToken: token.access_token,
        expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 - 60_000,
      };
      this.stored.email = await this.fetchEmail().catch(() => undefined);
      await this.persist();
      return { status: await this.getStatus() };
    } finally {
      await this.loopback.cancel(port).catch(() => undefined);
    }
  }

  private async exchange(params: Record<string, string>): Promise<TokenResponse> {
    if (!this.config) throw new AppError("AUTH_REQUIRED", "OAuth not configured.");
    const body = new URLSearchParams({ client_id: this.config.clientId, ...params });
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);
    let response: Response;
    try {
      response = await httpFetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (err) {
      throw new AppError("NETWORK_ERROR", "Could not reach Google's token service.", { cause: err });
    }
    const json = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok) {
      log.warn("token endpoint error", json.error ?? response.status);
      if (json.error === "invalid_grant") {
        throw new AppError("AUTH_EXPIRED", "Your Google session is no longer valid. Sign in again.", { detail: json.error });
      }
      throw new AppError("INVALID_CREDENTIAL", "Google rejected the sign-in.", { detail: json.error ?? `HTTP ${response.status}` });
    }
    return json;
  }

  async refresh(): Promise<AuthResult> {
    await this.load();
    if (!this.stored) throw new AppError("AUTH_REQUIRED", "Not signed in.");
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const token = await this.exchange({ grant_type: "refresh_token", refresh_token: this.stored!.refreshToken }).catch(async (err) => {
          if (err instanceof AppError && err.code === "AUTH_EXPIRED") {
            this.stored = null;
            await this.persist();
          }
          throw err;
        });
        if (!token.access_token) throw new AppError("AUTH_EXPIRED", "Google did not return an access token.");
        this.stored = {
          ...this.stored!,
          accessToken: token.access_token,
          expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 - 60_000,
          ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
        };
        await this.persist();
      })().finally(() => {
        this.refreshing = null;
      });
    }
    await this.refreshing;
    return { status: await this.getStatus() };
  }

  async revoke(): Promise<void> {
    await this.load();
    const token = this.stored?.refreshToken ?? this.stored?.accessToken;
    this.stored = null;
    await this.persist();
    if (token) {
      await httpFetch(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      }).catch((err) => log.warn("revoke failed", err));
    }
  }

  async getStatus(): Promise<AuthStatus> {
    await this.load();
    if (!this.stored) return { state: "unauthenticated", kind: "oauth" };
    return {
      state: "authenticated",
      kind: "oauth",
      ...(this.stored.email ? { label: this.stored.email } : {}),
      ...(this.stored.projectId ? { projectId: this.stored.projectId } : {}),
    };
  }

  async setProjectId(projectId: string | undefined): Promise<void> {
    await this.load();
    if (!this.stored) throw new AppError("AUTH_REQUIRED", "Not signed in.");
    const trimmed = projectId?.trim();
    if (trimmed && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(trimmed)) {
      throw new AppError("INVALID_REQUEST", "This does not look like a Google Cloud project ID.");
    }
    if (trimmed) this.stored.projectId = trimmed;
    else delete this.stored.projectId;
    await this.persist();
  }

  private async accessToken(): Promise<string> {
    await this.load();
    if (!this.stored) throw new AppError("AUTH_REQUIRED", "Sign in with Google first.");
    if (Date.now() >= this.stored.expiresAt) await this.refresh();
    return this.stored!.accessToken;
  }

  async getRequestHeaders(): Promise<Record<string, string>> {
    const token = await this.accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (this.stored?.projectId) headers["x-goog-user-project"] = this.stored.projectId;
    return headers;
  }

  private async fetchEmail(): Promise<string | undefined> {
    const response = await httpFetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${this.stored!.accessToken}` } });
    if (!response.ok) return undefined;
    const json = (await response.json()) as { email?: string };
    return json.email;
  }

  /** Lists the user's active Cloud projects so they can pick the one to bill. */
  async listProjects(): Promise<GoogleCloudProject[]> {
    const token = await this.accessToken();
    const url = new URL(PROJECTS_ENDPOINT);
    url.searchParams.set("filter", "lifecycleState:ACTIVE");
    url.searchParams.set("pageSize", "100");
    const response = await httpFetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      throw new AppError("PERMISSION_DENIED", "Could not list your Google Cloud projects. Enter a project ID manually.", {
        detail: `HTTP ${response.status}`,
      });
    }
    const json = (await response.json()) as { projects?: Array<{ projectId: string; name?: string }> };
    return (json.projects ?? []).map((p) => ({ projectId: p.projectId, name: p.name ?? p.projectId }));
  }
}
