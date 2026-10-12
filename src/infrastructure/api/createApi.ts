import type { LayeredSecretStore, SecretStore } from "@/infrastructure/auth/SecretStore";
import { createLogger } from "@/lib/logger";
import { isTauri } from "@/infrastructure/platform/capabilities";
import { ApiClient, type FetchLike } from "./ApiClient";
import { SessionTokenStore } from "./session";

/** The app's link to the API: the client, the apps' session token and who to tell when the session ends. */
export interface ApiServices {
  client: ApiClient;
  session: SessionTokenStore;
  /** Subscribes to "the API answered 401"; returns the unsubscribe function. */
  onUnauthenticated(listener: () => void): () => void;
}

/**
 * Web: the browser's fetch with same-origin cookies. Tauri: the HTTP plugin's fetch (restricted by the capability
 * scope) with a bearer token kept in the OS keychain.
 */
export function createApi(origin: string, secrets: LayeredSecretStore, options: { tauri?: boolean; fetch?: FetchLike } = {}): ApiServices {
  // A shell can mangle "/" (Git Bash turns it into "C:/Program Files/Git/"): refuse to start rather than call elsewhere.
  if (origin !== "/" && !/^https?:\/\/[^/?#]+\/?$/.test(origin)) throw new Error(`VITE_API_ORIGIN must be "/" or an http(s) origin, not "${origin}".`);
  const tauri = options.tauri ?? isTauri();
  const session = new SessionTokenStore(keychainTier(secrets), tauri);
  const listeners = new Set<() => void>();
  const fetch: FetchLike =
    options.fetch ??
    (tauri
      ? async (input, init) => {
          const mod = await import("@tauri-apps/plugin-http");
          return mod.fetch(input, init);
        }
      : (input, init) => globalThis.fetch(input, init));
  const client = new ApiClient({
    origin,
    fetch,
    bearer: () => session.get(),
    onSessionToken: (token) => session.set(token),
    onUnauthenticated: () => listeners.forEach((l) => l()),
  });
  return {
    client,
    session,
    onUnauthenticated(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const log = createLogger("api");

/**
 * The session token is always remembered: the OS keychain on desktop. Phones have no keystore integration yet,
 * so the token stays in memory and the app asks to sign in again after a restart.
 */
function keychainTier(secrets: LayeredSecretStore): SecretStore {
  return {
    persistent: secrets.canPersist,
    get: (key) => secrets.get(key),
    set: async (key, value) => {
      try {
        await secrets.set(key, value, secrets.canPersist);
      } catch {
        // The memory tier kept it; only "stay signed in after a restart" is lost.
        log.warn("the keychain refused the session token; it is kept until the app closes");
      }
    },
    delete: (key) => secrets.delete(key),
  };
}
