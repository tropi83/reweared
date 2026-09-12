import { AppError, DEFAULT_SETTINGS } from "@/domain/models";
import { GenerationQueue } from "@/domain/services/generation-queue";
import { UsageTracker } from "@/domain/services/usage-tracker";
import type { ImageProvider } from "@/domain/services/image-provider";
import { GeminiAuthManager } from "@/infrastructure/auth/GeminiAuthManager";
import { CloudflareAuth } from "@/infrastructure/providers/cloudflare/CloudflareAuth";
import { CLOUDFLARE_PROVIDER_ID, CloudflareProvider } from "@/infrastructure/providers/cloudflare/CloudflareProvider";
import { GEMINI_PROVIDER_ID, GeminiProvider } from "@/infrastructure/providers/gemini/GeminiProvider";
import { CloudflareListingCopyProvider } from "@/infrastructure/providers/cloudflare/CloudflareListingCopy";
import { GeminiListingCopyProvider } from "@/infrastructure/providers/gemini/GeminiListingCopy";
import type { ListingCopyProvider } from "@/domain/services/listing-copy";
import { createSecretStore } from "@/infrastructure/auth/SecretStore";
import { MOCK_PROVIDER_ID, MockImageProvider } from "@/infrastructure/providers/mock/MockImageProvider";
import { createStorageProvider, type StorageProvider } from "@/infrastructure/storage";

/**
 * Composition root. Everything stateful and long-lived is created once here and injected
 * into the stores, so tests can build an alternative container with mocks.
 */
export interface AppServices {
  storage: StorageProvider;
  auth: GeminiAuthManager;
  providers: Map<string, ImageProvider>;
  /** Vision models that write listing copy, keyed by the same provider ids. */
  copyProviders: Map<string, ListingCopyProvider>;
  mock: MockImageProvider;
  gemini: GeminiProvider;
  cloudflare: CloudflareProvider;
  cloudflareAuth: CloudflareAuth;
  queue: GenerationQueue;
  usage: UsageTracker;
  appVersion: string;
}

export const USAGE_META_KEY = "usage";

export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "0.1.0";

export const MOCK_ENABLED: boolean = import.meta.env.VITE_ENABLE_MOCK_PROVIDER === "true" || import.meta.env.DEV;

/**
 * Gemini image models have no free tier (pricing checked 2026-09-11), so image generation goes
 * through Cloudflare Workers AI only; Google is kept for listing copy (text models, free tier).
 * Flip this to re-enable Gemini in the composer — the provider is still wired and tested.
 */
export const GEMINI_IMAGE_GENERATION_ENABLED = false;

let services: AppServices | null = null;

export function getServices(): AppServices {
  if (!services) throw new Error("Services not initialized");
  return services;
}

export function hasServices(): boolean {
  return services !== null;
}

/** Test hook. */
export function __setServices(value: AppServices | null) {
  services = value;
}

export function createServices(bindings: {
  buildRequest: ConstructorParameters<typeof GenerationQueue>[0]["buildRequest"];
  persistResult: ConstructorParameters<typeof GenerationQueue>[0]["persistResult"];
  onJobUpdate: ConstructorParameters<typeof GenerationQueue>[0]["onJobUpdate"];
  storage?: StorageProvider;
}): AppServices {
  const storage = bindings.storage ?? createStorageProvider();
  const secrets = createSecretStore();
  const auth = new GeminiAuthManager(secrets);
  const usage = new UsageTracker((record) => storage.writeMeta(USAGE_META_KEY, record));
  const gemini = new GeminiProvider(auth, usage);
  const cloudflareAuth = new CloudflareAuth(secrets, { read: (k) => storage.readMeta(k), write: (k, v) => storage.writeMeta(k, v) });
  const cloudflare = new CloudflareProvider(cloudflareAuth, usage);
  const mock = new MockImageProvider({ usage });
  // Gemini first: it is the default copy writer (Flash-Lite, free tier).
  const copyProviders = new Map<string, ListingCopyProvider>([
    [GEMINI_PROVIDER_ID, new GeminiListingCopyProvider(auth)],
    [CLOUDFLARE_PROVIDER_ID, new CloudflareListingCopyProvider(cloudflareAuth)],
  ]);
  // Cloudflare is the image path (10,000 free neurons/day); Gemini only if explicitly re-enabled.
  const providers = new Map<string, ImageProvider>([[CLOUDFLARE_PROVIDER_ID, cloudflare]]);
  if (GEMINI_IMAGE_GENERATION_ENABLED) providers.set(GEMINI_PROVIDER_ID, gemini);
  if (MOCK_ENABLED) providers.set(MOCK_PROVIDER_ID, mock);

  const queue = new GenerationQueue(
    {
      getProvider: async (id) => {
        const provider = providers.get(id);
        if (!provider) throw new AppError("PROVIDER_UNAVAILABLE", `Unknown provider "${id}".`, { retryable: false });
        return provider;
      },
      buildRequest: bindings.buildRequest,
      persistResult: bindings.persistResult,
      onJobUpdate: bindings.onJobUpdate,
    },
    {
      concurrency: DEFAULT_SETTINGS.maxConcurrentJobs,
      maxAttempts: DEFAULT_SETTINGS.maxAttempts,
      timeoutMs: DEFAULT_SETTINGS.jobTimeoutMs,
    },
  );

  services = { storage, auth, providers, copyProviders, mock, gemini, cloudflare, cloudflareAuth, queue, usage, appVersion: APP_VERSION };
  return services;
}
