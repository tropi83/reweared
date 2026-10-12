import type { AuthStatus } from "@aiv/domain/models";

/**
 * Two ways to reach Workers AI:
 * - "direct": the Cloudflare REST API with an account ID + API token (what the server's worker uses);
 * - "worker": a small Worker deployed in a Cloudflare account, for browsers (api.cloudflare.com sends no CORS headers).
 *   It served the bring-your-own-key releases (template on the `byok` branch); the platform does not use it.
 */
export type CloudflareMode = "direct" | "worker";

export interface CloudflareConfig {
  mode: CloudflareMode;
  accountId?: string;
  workerUrl?: string;
}

export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/** What the adapters need from wherever the Cloudflare credentials live (OS keychain in the app, Docker secrets on the server). */
export interface CloudflareCredentials {
  getConfig(): Promise<CloudflareConfig | null>;
  getStatus(): Promise<AuthStatus>;
  resolveEndpoint(modelId: string): Promise<{ url: string; headers: Record<string, string> }>;
  /** The provider refused the credential; the source may show it as invalid until it changes. */
  markRejected(): void;
}
