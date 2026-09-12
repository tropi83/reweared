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

import { AppError } from "@/domain/models";
import { createSecretStore, LayeredSecretStore, MemorySecretStore, type SecretStore } from "./SecretStore";

const KEY = "AIzaSyTESTKEY0000000000000000000000000";

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
});

describe("createSecretStore", () => {
  it("keeps secrets in memory only on phones: nothing to remember, no keychain call", async () => {
    Object.assign(platform, { isTauri: true, isMobile: true });
    const store = createSecretStore();
    expect(store.canPersist).toBe(false);
    await store.set("gemini_api_key", KEY, true);
    expect(await store.get("gemini_api_key")).toBe(KEY);
    expect(await store.isRemembered("gemini_api_key")).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the OS keychain on desktop", async () => {
    Object.assign(platform, { isTauri: true, isMobile: false });
    invoke.mockResolvedValue(null);
    const store = createSecretStore();
    expect(store.canPersist).toBe(true);
    await store.set("cloudflare_api_token", "cf-token-0123456789abcdef", true);
    expect(invoke).toHaveBeenCalledWith("secret_set", { key: "cloudflare_api_token", value: "cf-token-0123456789abcdef" });
  });

  it("offers opt-in browser storage on the web", () => {
    Object.assign(platform, { isTauri: false, isMobile: false });
    expect(createSecretStore().canPersist).toBe(true);
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
    const err: unknown = await store.set("gemini_api_key", KEY, true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "STORAGE_ERROR", retryable: false, detail: "credential store unavailable: no Secret Service provider" });
    expect(await store.get("gemini_api_key")).toBe(KEY);
  });
});
