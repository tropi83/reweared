import { AppError, toGenerationError } from "@/domain/models";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { createLogger } from "@/lib/logger";

const log = createLogger("secrets");

/**
 * Secret keys are a closed set, mirrored by the Rust command allowlist. Adding a secret means
 * adding it here and in src-tauri/src/secrets.rs.
 */
export type SecretKey = "gemini_api_key" | "google_oauth" | "cloudflare_api_token" | "cloudflare_worker_secret";

/**
 * Where credentials live.
 *
 * - Native desktop: OS credential store (Windows Credential Manager, macOS Keychain, Secret
 *   Service) through the `secret_*` Tauri commands. Never on disk in clear text.
 * - Web: memory by default; localStorage only if the user explicitly opts in ("Remember on this
 *   device") after acknowledging the browser disclaimer.
 * - Mobile (until the keystore integration lands): memory only.
 */
export interface SecretStore {
  readonly persistent: boolean;
  get(key: SecretKey): Promise<string | null>;
  set(key: SecretKey, value: string): Promise<void>;
  delete(key: SecretKey): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  readonly persistent = false;
  private readonly values = new Map<SecretKey, string>();
  async get(key: SecretKey) {
    return this.values.get(key) ?? null;
  }
  async set(key: SecretKey, value: string) {
    this.values.set(key, value);
  }
  async delete(key: SecretKey) {
    this.values.delete(key);
  }
}

const WEB_PREFIX = "aiv.secret.";

/** Browser localStorage. Explicitly opt-in; the UI shows the disclaimer before enabling it. */
export class WebLocalSecretStore implements SecretStore {
  readonly persistent = true;
  async get(key: SecretKey) {
    try {
      return localStorage.getItem(WEB_PREFIX + key);
    } catch {
      return null;
    }
  }
  async set(key: SecretKey, value: string) {
    localStorage.setItem(WEB_PREFIX + key, value);
  }
  async delete(key: SecretKey) {
    try {
      localStorage.removeItem(WEB_PREFIX + key);
    } catch {
      /* ignore */
    }
  }
}

/** Desktop keychain via Rust. */
export class TauriKeychainSecretStore implements SecretStore {
  readonly persistent = true;
  private async invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  async get(key: SecretKey) {
    try {
      return await this.invoke<string | null>("secret_get", { key });
    } catch (err) {
      log.warn("secret_get failed", err);
      return null;
    }
  }
  async set(key: SecretKey, value: string) {
    await this.invoke("secret_set", { key, value });
  }
  async delete(key: SecretKey) {
    try {
      await this.invoke("secret_delete", { key });
    } catch (err) {
      log.warn("secret_delete failed", err);
    }
  }
}

/**
 * Two-tier store: the session tier is always memory; the persistent tier is used only when
 * `remember` is true for a given write. Reads check memory first, then the persistent tier.
 */
export class LayeredSecretStore {
  constructor(
    private readonly session: SecretStore,
    private readonly persistentStore: SecretStore | null,
  ) {}

  get canPersist(): boolean {
    return this.persistentStore !== null;
  }

  async get(key: SecretKey): Promise<string | null> {
    const inSession = await this.session.get(key);
    if (inSession !== null) return inSession;
    const stored = (await this.persistentStore?.get(key)) ?? null;
    if (stored !== null) await this.session.set(key, stored);
    return stored;
  }

  /**
   * The session tier always gets the value. When the persistent tier refuses it (for example Linux
   * without a Secret Service provider), the key still works until the app closes and the caller
   * gets a STORAGE_ERROR carrying the platform's reason.
   */
  async set(key: SecretKey, value: string, remember: boolean): Promise<void> {
    await this.session.set(key, value);
    if (!remember || !this.persistentStore) {
      await this.persistentStore?.delete(key);
      return;
    }
    try {
      await this.persistentStore.set(key, value);
    } catch (err) {
      throw new AppError("STORAGE_ERROR", "The key works until the app closes, but this device's secure storage refused to keep it.", {
        retryable: false,
        detail: toGenerationError(err).message,
      });
    }
  }

  async isRemembered(key: SecretKey): Promise<boolean> {
    return ((await this.persistentStore?.get(key)) ?? null) !== null;
  }

  async delete(key: SecretKey): Promise<void> {
    await this.session.delete(key);
    await this.persistentStore?.delete(key);
  }
}

export function createSecretStore(): LayeredSecretStore {
  const platform = getPlatform();
  if (platform.isTauri) {
    // Desktop: OS keychain. Phones: no keystore integration yet (the Rust command refuses writes), so
    // memory only — `canPersist` is false and the UI does not offer "Remember".
    return new LayeredSecretStore(new MemorySecretStore(), platform.secureStorage ? new TauriKeychainSecretStore() : null);
  }
  const hasLocalStorage = typeof localStorage !== "undefined";
  return new LayeredSecretStore(new MemorySecretStore(), hasLocalStorage ? new WebLocalSecretStore() : null);
}
