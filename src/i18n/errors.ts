import type { GenerationErrorCode } from "@aiv/domain/models";
import { en } from "./en";
import { t, type MessageKey } from "./index";

/**
 * User-facing message for an error, preferring a scope-specific wording (`error.<scope>.<code>`, e.g. the platform's
 * credits and daily limit, or the Vinted window) over the generic one (`error.<code>`).
 */
export function errorMessage(error: { code: GenerationErrorCode }, scope?: string): string {
  const specific = scope ? `error.${scope}.${error.code}` : undefined;
  return t((specific && specific in en ? specific : `error.${error.code}`) as MessageKey);
}
