import type { AuthStatus } from "@aiv/domain/models";

/**
 * Two ways to reach Workers AI:
 * - "direct": the Cloudflare REST API with an account ID + API token (the server's worker, the desktop app);
 * - "worker": a small Worker deployed in the user's own account (template in cloudflare-worker/), for browsers
 *   (api.cloudflare.com sends no CORS headers).
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
