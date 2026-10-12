import type { SecretStore } from "@/infrastructure/auth/SecretStore";

/**
 * The desktop and phone apps' API session: a bearer token kept in the OS keychain (`session_token`), never in
 * web storage, logs or diagnostics. The web app has no token (httpOnly cookies), so its store stays empty.
 */
export class SessionTokenStore {
  private cached: string | null | undefined;

  constructor(
    private readonly secrets: SecretStore,
    private readonly enabled: boolean,
  ) {}

  async get(): Promise<string | null> {
    if (!this.enabled) return null;
    if (this.cached === undefined) this.cached = await this.secrets.get("session_token");
    return this.cached;
  }

  async set(token: string): Promise<void> {
    if (!this.enabled) return;
    this.cached = token;
    await this.secrets.set("session_token", token);
  }

  async clear(): Promise<void> {
    this.cached = null;
    if (this.enabled) await this.secrets.delete("session_token");
  }
}
