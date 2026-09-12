import type { AspectRatio, ImageSize } from "./generation";
import type { Mannequin } from "./mannequin";

export type ThemePreference = "system" | "dark" | "light";
export type Locale = "en" | "fr";

export const SETTINGS_SCHEMA_VERSION = 1;

export interface AppSettings {
  schemaVersion: number;
  locale: Locale;
  theme: ThemePreference;
  /** Provider selected in the composer. */
  activeProviderId: string;
  /** Last chosen model per provider. */
  lastModelByProvider: Record<string, string>;
  /** Vision provider that writes the listing title/description (independent from the image provider). */
  copyProviderId: string;
  /** Chosen copy model per provider; unset = the provider's default (cheapest). */
  copyModelByProvider: Record<string, string>;
  defaultVariationCount: number;
  defaultAspectRatio: AspectRatio;
  defaultImageSize?: ImageSize;
  /** Maximum simultaneous provider requests. */
  maxConcurrentJobs: number;
  /** Per-job timeout in milliseconds. */
  jobTimeoutMs: number;
  /** Maximum automatic attempts per job (1 = no automatic retry). */
  maxAttempts: number;
  /** Downscale images larger than this (longest side) before sending to a provider. */
  prepareMaxDimension: number;
  /** Whether the user acknowledged the browser credential disclaimer (web only). */
  webCredentialDisclaimerAccepted: boolean;
  /** Ads are disabled by default in the MVP; kept for the entitlement model. */
  adsEnabled: boolean;
  /** The user read the Vinted terms warning before the first automated pre-fill. */
  vintedAutomationAcknowledged: boolean;
  /** The seller's mannequin for photos with a person; absent until created (listing card or Settings → Mannequin). */
  mannequin?: Mannequin | undefined;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  locale: "en",
  theme: "system",
  activeProviderId: "cloudflare",
  lastModelByProvider: {},
  // Gemini text models have a free tier and Flash-Lite is the cheapest vision model we know of.
  copyProviderId: "gemini",
  copyModelByProvider: {},
  defaultVariationCount: 4,
  defaultAspectRatio: "original",
  maxConcurrentJobs: 2,
  jobTimeoutMs: 120_000,
  maxAttempts: 3,
  prepareMaxDimension: 3072,
  webCredentialDisclaimerAccepted: false,
  adsEnabled: false,
  vintedAutomationAcknowledged: false,
};

export interface Entitlement {
  adsEnabled: boolean;
  tier: "free" | "supporter";
}
