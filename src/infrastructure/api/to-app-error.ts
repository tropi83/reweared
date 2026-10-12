import { AppError, GENERATION_ERROR_CODES, type GenerationErrorCode } from "@aiv/domain/models";
import { ApiError } from "./ApiClient";

const PASS_THROUGH: ReadonlySet<string> = new Set(GENERATION_ERROR_CODES);

/** HTTP-only codes of the API (`HTTP_ERROR_CODES`) in the app's error vocabulary. */
const MAPPED: Record<string, { code: GenerationErrorCode; detail?: string }> = {
  UNAUTHENTICATED: { code: "AUTH_REQUIRED" },
  EMAIL_NOT_VERIFIED: { code: "AUTH_REQUIRED" },
  PAYLOAD_TOO_LARGE: { code: "INVALID_IMAGE", detail: "TOO_LARGE" },
  UNSUPPORTED_MEDIA_TYPE: { code: "UNSUPPORTED_FORMAT" },
  VALIDATION_FAILED: { code: "INVALID_REQUEST" },
  INSUFFICIENT_CREDITS: { code: "QUOTA_EXCEEDED", detail: "INSUFFICIENT_CREDITS" },
};

/**
 * An `ApiError` as an `AppError`, so the existing error messages and toasts apply. The server's message is user-safe
 * by contract (never a stack trace or a secret); its code is kept in `detail` for diagnostics.
 */
export function toAppError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  const mapped = MAPPED[error.code];
  if (mapped) return new AppError(mapped.code, error.message, { detail: mapped.detail ?? error.code, cause: error });
  if (PASS_THROUGH.has(error.code)) return new AppError(error.code as GenerationErrorCode, error.message, { detail: `HTTP ${error.status}`, cause: error });
  return new AppError("UNKNOWN_ERROR", error.message, { detail: `${error.code} (HTTP ${error.status})`, cause: error });
}
