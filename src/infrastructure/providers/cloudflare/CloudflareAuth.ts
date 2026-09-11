import { AppError, type AuthStatus } from "@/domain/models";
import type { LayeredSecretStore } from "@/infrastructure/auth/SecretStore";
import { getPlatform } from "@/infrastructure/platform/capabilities";

/**
 * Two ways to reach Workers AI, both entirely in the user's own Cloudflare account:
 *
 * - "direct": the Cloudflare REST API with an account ID + API token ("Workers AI" template,
 *   Read + Edit). api.cloudflare.com sends no CORS headers (verified 2026-09-11: OPTIONS → 405),
 *   so this mode only works from the desktop app (requests go through the Tauri http plugin).
 * - "worker": a tiny Worker the user deploys in their account (template in cloudflare-worker/),
 *   which calls the model through the `env.AI` binding and answers with CORS headers. No token
 *   ever leaves Cloudflare; an optional shared secret protects the endpoint. Works everywhere.
 */
export type CloudflareMode = "direct" | "worker";

export interface CloudflareConfig {
  mode: CloudflareMode;
  accountId?: string;
  workerUrl?: string;
}

export const CLOUDFLARE_CONFIG_META_KEY = "cloudflare-config";
export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

export interface MetaStore {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
}

const ACCOUNT_ID = /^[a-f0-9]{32}$/;

export function normalizeWorkerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError("INVALID_REQUEST", "Enter the full Worker URL, e.g. https://aiv.your-name.workers.dev");
  }
  if (url.protocol !== "https:") throw new AppError("INVALID_REQUEST", "The Worker URL must use https.");
  if (url.username || url.password || url.search || url.hash)
    throw new AppError("INVALID_REQUEST", "The Worker URL must not contain credentials or query parameters.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export class CloudflareAuth {
  private config: CloudflareConfig | null = null;
  private loading: Promise<void> | null = null;
  private rejected = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly secrets: LayeredSecretStore,
    private readonly meta: MetaStore,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  private load(): Promise<void> {
    this.loading ??= this.meta.read<CloudflareConfig>(CLOUDFLARE_CONFIG_META_KEY).then((cfg) => {
      this.config = cfg && (cfg.mode === "direct" || cfg.mode === "worker") ? cfg : null;
    });
    return this.loading;
  }

  async getConfig(): Promise<CloudflareConfig | null> {
    await this.load();
    return this.config;
  }

  get directSupported(): boolean {
    return getPlatform().isTauri;
  }

  async saveDirect(input: { accountId: string; apiToken: string; remember: boolean }): Promise<void> {
    const accountId = input.accountId.trim().toLowerCase();
    const token = input.apiToken.trim();
    if (!ACCOUNT_ID.test(accountId)) throw new AppError("INVALID_CREDENTIAL", "The account ID is a 32-character hexadecimal string (Workers AI → Overview).");
    if (token.length < 20 || /\s/.test(token)) throw new AppError("INVALID_CREDENTIAL", "This does not look like a Cloudflare API token.");
    await this.secrets.set("cloudflare_api_token", token, input.remember);
    await this.load();
    this.config = { mode: "direct", accountId };
    this.rejected = false;
    await this.meta.write(CLOUDFLARE_CONFIG_META_KEY, this.config);
    this.notify();
  }

  async saveWorker(input: { workerUrl: string; secret?: string; remember: boolean }): Promise<void> {
    const workerUrl = normalizeWorkerUrl(input.workerUrl);
    const secret = input.secret?.trim() ?? "";
    if (secret) await this.secrets.set("cloudflare_worker_secret", secret, input.remember);
    else await this.secrets.delete("cloudflare_worker_secret");
    await this.load();
    this.config = { mode: "worker", workerUrl };
    this.rejected = false;
    await this.meta.write(CLOUDFLARE_CONFIG_META_KEY, this.config);
    this.notify();
  }

  async clear(): Promise<void> {
    await this.secrets.delete("cloudflare_api_token");
    await this.secrets.delete("cloudflare_worker_secret");
    await this.load();
    this.config = null;
    this.rejected = false;
    await this.meta.write(CLOUDFLARE_CONFIG_META_KEY, null);
    this.notify();
  }

  markRejected(): void {
    this.rejected = true;
    this.notify();
  }

  async isRemembered(): Promise<boolean> {
    return (await this.secrets.isRemembered("cloudflare_api_token")) || (await this.secrets.isRemembered("cloudflare_worker_secret"));
  }

  async getStatus(): Promise<AuthStatus> {
    await this.load();
    const cfg = this.config;
    if (!cfg) return { state: "unauthenticated", kind: "api_token" };
    if (cfg.mode === "direct") {
      const token = await this.secrets.get("cloudflare_api_token");
      if (!cfg.accountId || !token) return { state: "unauthenticated", kind: "api_token" };
      return { state: this.rejected ? "invalid" : "authenticated", kind: "api_token", label: `${cfg.accountId.slice(0, 6)}… · token …${token.slice(-4)}` };
    }
    if (!cfg.workerUrl) return { state: "unauthenticated", kind: "api_token" };
    return { state: this.rejected ? "invalid" : "authenticated", kind: "api_token", label: new URL(cfg.workerUrl).host };
  }

  /** Resolves where to send a model run and with which headers. */
  async resolveEndpoint(modelId: string): Promise<{ url: string; headers: Record<string, string> }> {
    await this.load();
    const cfg = this.config;
    if (!cfg) throw new AppError("AUTH_REQUIRED", "Configure Cloudflare Workers AI in Settings.");
    if (cfg.mode === "direct") {
      if (!this.directSupported) {
        throw new AppError("AUTH_REQUIRED", "Cloudflare's API cannot be called from a browser (no CORS). Use the Worker endpoint mode or the desktop app.");
      }
      const token = await this.secrets.get("cloudflare_api_token");
      if (!cfg.accountId || !token) throw new AppError("AUTH_REQUIRED", "Configure Cloudflare Workers AI in Settings.");
      return { url: `${CLOUDFLARE_API_BASE}/accounts/${cfg.accountId}/ai/run/${modelId}`, headers: { Authorization: `Bearer ${token}` } };
    }
    if (!cfg.workerUrl) throw new AppError("AUTH_REQUIRED", "Configure the Worker endpoint in Settings.");
    const secret = await this.secrets.get("cloudflare_worker_secret");
    return {
      url: `${cfg.workerUrl}/run/${modelId}`,
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    };
  }
}
