import { z } from "zod";
import { LOCALES } from "./shared";

export const mannequinDto = z.strictObject({
  build: z.enum(["S", "M", "L"]),
  pose: z.enum(["standing", "arched", "crouching", "sitting"]),
  skinTone: z.enum(["very-fair", "fair", "medium", "olive", "brown", "deep"]),
});

/**
 * The user-level settings the server keeps for an account. Device and provider settings (provider and model
 * choices, concurrency, timeouts, credential disclaimers) are not part of it: with the backend the platform
 * owns providers, and nothing credential-like is ever stored or returned. Unknown keys are refused.
 */
export const userSettingsDto = z.strictObject({
  locale: z.enum(LOCALES),
  theme: z.enum(["system", "dark", "light"]),
  mannequin: mannequinDto.optional(),
  vintedAutomationAcknowledged: z.boolean(),
  defaultAspectRatio: z.enum(["original", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]),
});
