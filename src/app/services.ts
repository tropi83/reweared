import { AppError, DEFAULT_SETTINGS } from "@/domain/models";
import { GenerationQueue } from "@/domain/services/generation-queue";
import { UsageTracker } from "@/domain/services/usage-tracker";
import type { ImageProvider } from "@/domain/services/image-provider";
import { GeminiAuthManager } from "@/infrastructure/auth/GeminiAuthManager";
import { CloudflareAuth } from "@/infrastructure/providers/cloudflare/CloudflareAuth";
import { CLOUDFLARE_PROVIDER_ID, CloudflareProvider } from "@/infrastructure/providers/cloudflare/CloudflareProvider";
import { GEMINI_PROVIDER_ID, GeminiProvider } from "@/infrastructure/providers/gemini/GeminiProvider";
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
  // Cloudflare first: its img2img models are free while in beta, which is the default path.
  const providers = new Map<string, ImageProvider>([
    [CLOUDFLARE_PROVIDER_ID, cloudflare],
    [GEMINI_PROVIDER_ID, gemini],
  ]);
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

  services = { storage, auth, providers, mock, gemini, cloudflare, cloudflareAuth, queue, usage, appVersion: APP_VERSION };
  return services;
}
