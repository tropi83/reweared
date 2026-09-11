/**
 * Normalized error vocabulary shared by every provider, the job queue and the UI.
 * Providers map their raw HTTP/SDK errors into one of these codes (see GeminiErrors.ts).
 */
export type GenerationErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "INVALID_CREDENTIAL"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_IMAGE"
  | "UNSUPPORTED_FORMAT"
  | "MODEL_UNAVAILABLE"
  | "MODEL_NOT_IN_PLAN"
  | "CONTENT_REJECTED"
  | "NO_IMAGE_RETURNED"
  | "CANCELLED"
  | "STORAGE_ERROR"
  | "UNKNOWN_ERROR";

export interface GenerationError {
  code: GenerationErrorCode;
  /** Human-readable, safe to display. Never contains credentials. */
  message: string;
  /** Whether an automatic retry may succeed. */
  retryable: boolean;
  /** Provider-suggested wait before retrying (ms), e.g. from a Retry-After header. */
  retryAfterMs?: number;
  /** Provider-specific detail for diagnostics (status code, provider error code). Never secrets. */
  detail?: string;
}

const RETRYABLE: ReadonlySet<GenerationErrorCode> = new Set(["RATE_LIMITED", "NETWORK_ERROR", "TIMEOUT", "PROVIDER_UNAVAILABLE"]);

export function isRetryableCode(code: GenerationErrorCode): boolean {
  return RETRYABLE.has(code);
}

export class AppError extends Error implements GenerationError {
  readonly code: GenerationErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly detail?: string;

  constructor(code: GenerationErrorCode, message: string, options: { retryable?: boolean; retryAfterMs?: number; detail?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? isRetryableCode(code);
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.detail !== undefined) this.detail = options.detail;
  }

  toJSON(): GenerationError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
    };
  }
}

export function isGenerationError(value: unknown): value is GenerationError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GenerationError).code === "string" &&
    typeof (value as GenerationError).message === "string" &&
    typeof (value as GenerationError).retryable === "boolean"
  );
}

/** Converts any thrown value into a serializable GenerationError. */
export function toGenerationError(err: unknown): GenerationError {
  if (err instanceof AppError) return err.toJSON();
  if (isGenerationError(err)) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return { code: "CANCELLED", message: "Generation was cancelled.", retryable: false };
  }
  if (err instanceof Error && err.name === "AbortError") {
    return { code: "CANCELLED", message: "Generation was cancelled.", retryable: false };
  }
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return { code: "NETWORK_ERROR", message: "Network error while contacting the provider.", retryable: true };
  }
  const message = err instanceof Error ? err.message : "Unexpected error.";
  return { code: "UNKNOWN_ERROR", message, retryable: false };
}
