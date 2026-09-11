import { create } from "zustand";
import { DEFAULT_SETTINGS, type AppSettings } from "@/domain/models";
import { setLocale } from "@/i18n";
import { getServices } from "../services";
import { applyTheme } from "../theme";

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<AppSettings>): Promise<void>;
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
    const settings = stored ?? { ...DEFAULT_SETTINGS };
    if (typeof navigator !== "undefined" && !stored && navigator.language.toLowerCase().startsWith("fr")) settings.locale = "fr";
    set({ settings, loaded: true });
    applySideEffects(settings);
  },
  async update(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    applySideEffects(settings);
    await getServices().storage.saveSettings(settings);
  },
}));
