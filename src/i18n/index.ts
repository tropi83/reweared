import { useSyncExternalStore } from "react";
import type { Locale } from "@/domain/models";
import { en } from "./en";
import { fr } from "./fr";

export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

const dictionaries: Record<Locale, Dictionary> = { en, fr: { ...en, ...fr } };

let currentLocale: Locale = "en";
const listeners = new Set<() => void>();

export function setLocale(locale: Locale) {
  if (locale === currentLocale) return;
  currentLocale = locale;
  document.documentElement.lang = locale;
  listeners.forEach((l) => l());
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Interpolates `{name}` placeholders. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = dictionaries[currentLocale][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => currentLocale,
  );
}

/** Hook variant that re-renders on locale change. */
export function useT() {
  useLocale();
  return t;
}
