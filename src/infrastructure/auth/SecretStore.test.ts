/**
 * Which persistent tier each platform gets, and what happens when that tier refuses a write.
 * Regression: on Android the Rust keychain command always fails ("not available on this platform
 * yet"), yet it was wired as the persistent tier, so "Remember" surfaced an opaque error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ isTauri: false, isMobile: false }));
const invoke = vi.hoisted(() => vi.fn());

vi.mock("@/infrastructure/platform/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/platform/capabilities")>();
  return {
    ...actual,
    isTauri: () => platform.isTauri,
    getPlatform: () => ({
      ...actual.getPlatform(),
      isTauri: platform.isTauri,
      isMobile: platform.isMobile,
      secureStorage: platform.isTauri && !platform.isMobile,
    }),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { AppError } from "@aiv/domain/models";
import { createSecretStore, LayeredSecretStore, MemorySecretStore, purgeLegacyCredentials, type SecretStore } from "./SecretStore";

const KEY = "session-token-0123456789";

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
});

describe("createSecretStore", () => {
  it("keeps secrets in memory only on phones: nothing to remember, no keychain call", async () => {
    Object.assign(platform, { isTauri: true, isMobile: true });
    const store = createSecretStore();
    expect(store.canPersist).toBe(false);
    await store.set("session_token", KEY, true);
    expect(await store.get("session_token")).toBe(KEY);
    expect(await store.isRemembered("session_token")).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the OS keychain on desktop", async () => {
    Object.assign(platform, { isTauri: true, isMobile: false });
    invoke.mockResolvedValue(null);
    const store = createSecretStore();
    expect(store.canPersist).toBe(true);
    await store.set("session_token", "cf-token-0123456789abcdef", true);
    expect(invoke).toHaveBeenCalledWith("secret_set", { key: "session_token", value: "cf-token-0123456789abcdef" });
  });

  it("keeps nothing on the web: the session is an httpOnly cookie", () => {
    Object.assign(platform, { isTauri: false, isMobile: false });
    expect(createSecretStore().canPersist).toBe(false);
  });
});

describe("LayeredSecretStore when the persistent tier refuses a write", () => {
  it("keeps the key for the session and reports a storage error with the platform's reason", async () => {
    // Tauri's invoke rejects with the command's error string, not an Error.
    const refusing: SecretStore = {
      persistent: true,
      get: async () => null,
      set: () => Promise.reject("credential store unavailable: no Secret Service provider"),
      delete: async () => undefined,
    };
    const store = new LayeredSecretStore(new MemorySecretStore(), refusing);
    const err: unknown = await store.set("session_token", KEY, true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "STORAGE_ERROR", retryable: false, detail: "credential store unavailable: no Secret Service provider" });
    expect(await store.get("session_token")).toBe(KEY);
  });
});

describe("purgeLegacyCredentials", () => {
  it("deletes the keys a bring-your-own-key release left in the browser and in the keychain", async () => {
    localStorage.setItem("aiv.secret.gemini_api_key", "AIza-old");
    localStorage.setItem("aiv.theme", "dark");
    Object.assign(platform, { isTauri: true, isMobile: false });
    invoke.mockResolvedValue(2);
    await purgeLegacyCredentials();
    expect(localStorage.getItem("aiv.secret.gemini_api_key")).toBeNull();
    expect(localStorage.getItem("aiv.theme")).toBe("dark");
    expect(invoke).toHaveBeenCalledWith("secret_purge_legacy");
  });

  it("never calls the keychain on phones or the web", async () => {
    Object.assign(platform, { isTauri: true, isMobile: true });
    await purgeLegacyCredentials();
    Object.assign(platform, { isTauri: false, isMobile: false });
    await purgeLegacyCredentials();
    expect(invoke).not.toHaveBeenCalled();
  });
});
