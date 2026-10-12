import { t, type MessageKey } from "@/i18n";
import { ApiError } from "@/infrastructure/api/ApiClient";

const KNOWN: Record<string, MessageKey> = {
  INVALID_EMAIL_OR_PASSWORD: "account.error.INVALID_EMAIL_OR_PASSWORD",
  USER_ALREADY_EXISTS: "account.error.USER_ALREADY_EXISTS",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "account.error.USER_ALREADY_EXISTS",
  PASSWORD_TOO_SHORT: "account.error.PASSWORD_TOO_SHORT",
  INVALID_EMAIL: "account.error.INVALID_EMAIL",
  INVALID_TOKEN: "account.error.INVALID_TOKEN",
  NETWORK_ERROR: "account.error.NETWORK_ERROR",
  RATE_LIMITED: "account.error.RATE_LIMITED",
};

/** User-facing message for an account error: the server's code mapped to our wording, never its raw text. */
export function accountErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return t("account.error.RATE_LIMITED");
    const key = KNOWN[error.code];
    if (key) return t(key);
  }
  if (typeof error === "string" && KNOWN[error]) return t(KNOWN[error]);
  return t("account.error.generic");
}
