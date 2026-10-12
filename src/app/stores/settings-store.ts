import { create } from "zustand";
import type { z } from "zod";
import { DEFAULT_SETTINGS, type AppSettings } from "@aiv/domain/models";
import { userSettingsDto } from "@aiv/contracts/settings";
import { createLogger } from "@/lib/logger";
import { setLocale } from "@/i18n";
import { getServices } from "../services";
import { applyTheme } from "../theme";

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<AppSettings>): Promise<void>;
  /** API mode, at sign-in: the account's settings (shared by its devices) replace the device's copy of them. */
  pullAccountSettings(): Promise<void>;
}

const log = createLogger("settings");

type AccountSettings = z.infer<typeof userSettingsDto>;

/** The settings the account keeps on the server (the server plans photo packs with its mannequin). */
const ACCOUNT_KEYS = ["locale", "theme", "mannequin", "vintedAutomationAcknowledged", "defaultAspectRatio"] as const;

function accountPart(settings: AppSettings): AccountSettings {
  return {
    locale: settings.locale,
    theme: settings.theme,
    ...(settings.mannequin ? { mannequin: settings.mannequin } : {}),
    vintedAutomationAcknowledged: settings.vintedAutomationAcknowledged,
    defaultAspectRatio: settings.defaultAspectRatio,
  };
}

function applySideEffects(settings: AppSettings) {
  setLocale(settings.locale);
  applyTheme(settings.theme);
  const { queue } = getServices();
  queue.configure({ concurrency: settings.maxConcurrentJobs, maxAttempts: settings.maxAttempts, timeoutMs: settings.jobTimeoutMs });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const stored = await getServices().storage.getSettings();
    // Spread over the defaults so settings saved by an older build get the new fields.
    const settings = stored ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS };
    if (typeof navigator !== "undefined" && !stored && navigator.language.toLowerCase().startsWith("fr")) settings.locale = "fr";
    set({ settings, loaded: true });
    applySideEffects(settings);
  },
  async update(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    applySideEffects(settings);
    await getServices().storage.saveSettings(settings);
    const api = getServices().api;
    if (api && ACCOUNT_KEYS.some((key) => key in patch)) {
      // The device keeps working with its copy when the server cannot be reached; the next change sends it again.
      await api.client
        .request("PUT", "/api/v1/me/settings", { json: accountPart(settings), schema: userSettingsDto })
        .catch((error: unknown) => log.warn("account settings not saved", error));
    }
  },

  async pullAccountSettings() {
    const api = getServices().api;
    if (!api) return;
    const remote = await api.client.get("/api/v1/me/settings", userSettingsDto);
    const settings: AppSettings = { ...get().settings, ...remote };
    if (!remote.mannequin) delete settings.mannequin;
    set({ settings });
    applySideEffects(settings);
    await getServices().storage.saveSettings(settings);
  },
}));
