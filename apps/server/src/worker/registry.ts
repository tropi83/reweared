import type { FastifyBaseLogger } from "fastify";
import type { AuthStatus } from "@aiv/domain/models";
import type { ImageProvider } from "@aiv/domain/services/image-provider";
import type { ListingCopyProvider } from "@aiv/domain/services/listing-copy";
import { CloudflareProvider } from "@aiv/providers/cloudflare/CloudflareProvider";
import { CloudflareListingCopyProvider } from "@aiv/providers/cloudflare/CloudflareListingCopy";
import { CLOUDFLARE_API_BASE, type CloudflareConfig, type CloudflareCredentials } from "@aiv/providers/cloudflare/credentials";
import { GeminiProvider, type GeminiAuthSource } from "@aiv/providers/gemini/GeminiProvider";
import { GeminiListingCopyProvider } from "@aiv/providers/gemini/GeminiListingCopy";
import { setFetchResolver } from "@aiv/providers/http";
import { setProviderLoggerFactory } from "@aiv/providers/log";
import { MockCopyProvider, SharpMockImageProvider } from "../providers/sharp-mock";
import type { WorkerConfig } from "./config";

export interface Providers {
  image: ImageProvider;
  copy: ListingCopyProvider;
}

/** The platform's Cloudflare account, REST API mode (the server has no CORS limit). */
class PlatformCloudflareCredentials implements CloudflareCredentials {
  constructor(
    private readonly accountId: string,
    private readonly token: string,
    private readonly log: Pick<FastifyBaseLogger, "error">,
  ) {}

  async getConfig(): Promise<CloudflareConfig> {
    return { mode: "direct", accountId: this.accountId };
  }

  async getStatus(): Promise<AuthStatus> {
    return { state: "authenticated", kind: "api_token" };
  }

  async resolveEndpoint(modelId: string): Promise<{ url: string; headers: Record<string, string> }> {
    return { url: `${CLOUDFLARE_API_BASE}/accounts/${this.accountId}/ai/run/${modelId}`, headers: { Authorization: `Bearer ${this.token}` } };
  }

  markRejected(): void {
    this.log.error("the platform's Cloudflare token was rejected");
  }
}

/**
 * Builds the platform's providers from the worker config and installs Node's fetch and the worker's logger into
 * the shared adapters (allowlist still enforced by `httpFetch`). Keys stay inside these objects.
 */
export function buildProviders(config: WorkerConfig, log: FastifyBaseLogger): Providers {
  setFetchResolver(async () => (input, init) => globalThis.fetch(input, init));
  setProviderLoggerFactory((scope) => log.child({ provider: scope }));

  const cloudflare = () => new PlatformCloudflareCredentials(config.CLOUDFLARE_ACCOUNT_ID ?? "", config.CLOUDFLARE_API_TOKEN ?? "", log);
  const gemini: GeminiAuthSource = {
    getRequestHeaders: async () => ({ "x-goog-api-key": config.GEMINI_API_KEY ?? "" }),
    getStatus: async () => ({ state: "authenticated", kind: "api_key" }),
    onCredentialRejected: (code) => log.error({ code }, "the platform's Gemini key was rejected"),
  };

  const image: ImageProvider =
    config.IMAGE_PROVIDER === "cloudflare"
      ? new CloudflareProvider(cloudflare())
      : config.IMAGE_PROVIDER === "gemini"
        ? new GeminiProvider(gemini)
        : new SharpMockImageProvider();
  const copy: ListingCopyProvider =
    config.COPY_PROVIDER === "gemini"
      ? new GeminiListingCopyProvider(gemini)
      : config.COPY_PROVIDER === "cloudflare"
        ? new CloudflareListingCopyProvider(cloudflare())
        : new MockCopyProvider();
  return { image, copy };
}
