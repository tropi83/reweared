import { createSecretStore, type LayeredSecretStore } from "@/infrastructure/auth/SecretStore";
import { createStorageProvider, type StorageProvider } from "@/infrastructure/storage";
import { createPublishBridge } from "@/infrastructure/publish/createPublishBridge";
import type { PublishBridge } from "@/infrastructure/publish/PublishBridge";
import { createApi, type ApiServices } from "@/infrastructure/api/createApi";
import { API_ORIGIN } from "./api-origin";
import type { ListingRepository } from "./ports/listing-repository";
import { RemoteListingRepository } from "./ports/remote-listing-repository";
import { RemoteRunEngine } from "./ports/remote-run-engine";

/**
 * Composition root. Everything stateful and long-lived is created once here and injected
 * into the stores, so tests can build an alternative container with fakes.
 */
export interface AppServices {
  /** The API client, the session token and who to tell when the session ends. */
  api: ApiServices;
  /** Listings and their photos, on the server. */
  listings: ListingRepository;
  /** Photo packs and listing copy, run by the platform. */
  runs: RemoteRunEngine;
  /**
   * This device's storage: its settings (theme, language) and, read-only, the listings of the app's previous
   * local-first version for the one-time import (`LocalImport`).
   */
  storage: StorageProvider;
  /** The session token (OS keychain on desktop, memory on phones; the web app uses cookies). */
  secrets: LayeredSecretStore;
  publish: PublishBridge;
  appVersion: string;
}

export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "0.1.0";

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

export function createServices(bindings: { storage?: StorageProvider; api?: ApiServices } = {}): AppServices {
  const storage = bindings.storage ?? createStorageProvider();
  const secrets = createSecretStore();
  const api = bindings.api ?? createApi(API_ORIGIN, secrets);
  services = {
    api,
    listings: new RemoteListingRepository(api.client),
    runs: new RemoteRunEngine(api.client),
    storage,
    secrets,
    publish: createPublishBridge(),
    appVersion: APP_VERSION,
  };
  return services;
}
