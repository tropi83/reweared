import { AppError, type GenerationErrorCode } from "@/domain/models";
import type { GeminiErrorBody } from "./GeminiMapper";

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/**
 * Normalizes an HTTP failure from the Gemini API. The raw message is kept only in `detail`
 * (truncated) and never contains credentials since Google does not echo them back.
 */
export function mapGeminiHttpError(status: number, body: GeminiErrorBody | undefined, retryAfter: string | null): AppError {
  const message = body?.error?.message ?? "";
  const googleStatus = body?.error?.status ?? "";
  const detail = `HTTP ${status}${googleStatus ? ` ${googleStatus}` : ""}${message ? `: ${message.slice(0, 400)}` : ""}`;
  const lower = message.toLowerCase();

  let code: GenerationErrorCode;
  switch (status) {
    case 400:
      if (/api key|api_key/.test(lower) && /invalid|not valid/.test(lower)) code = "INVALID_CREDENTIAL";
      else if (/image|mime|media|decode/.test(lower) && /unsupported|invalid|unable/.test(lower)) code = "INVALID_IMAGE";
      else if (/safety|blocked|prohibited/.test(lower)) code = "CONTENT_REJECTED";
      else code = "INVALID_REQUEST";
      break;
    case 401:
      code = /expired/.test(lower) ? "AUTH_EXPIRED" : "INVALID_CREDENTIAL";
      break;
    case 403:
      if (/api key|api_key|leaked|restricted/.test(lower)) code = "INVALID_CREDENTIAL";
      else code = "PERMISSION_DENIED";
      break;
    case 404:
      code = /model/.test(lower) ? "MODEL_UNAVAILABLE" : "INVALID_REQUEST";
      break;
    case 413:
      code = "INVALID_IMAGE";
      break;
    case 429:
      code = /quota|billing|exceeded your current quota/.test(lower) && !/per minute|rate/.test(lower) ? "QUOTA_EXCEEDED" : "RATE_LIMITED";
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      code = "PROVIDER_UNAVAILABLE";
      break;
    default:
      code = status >= 500 ? "PROVIDER_UNAVAILABLE" : "UNKNOWN_ERROR";
  }

  const retryAfterMs = parseRetryAfter(retryAfter);
  return new AppError(code, userMessageFor(code), {
    detail,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}

/** Interaction finished without a usable image. */
export function mapInteractionOutcome(status: string | undefined, text: string): AppError {
  const lower = text.toLowerCase();
  if (status === "failed" || status === "incomplete" || status === "budget_exceeded") {
    if (/safety|policy|cannot|can't|unable to|not able/.test(lower)) {
      return new AppError("CONTENT_REJECTED", userMessageFor("CONTENT_REJECTED"), { detail: `status=${status}` });
    }
    return new AppError("PROVIDER_UNAVAILABLE", userMessageFor("PROVIDER_UNAVAILABLE"), { detail: `status=${status}` });
  }
  if (/safety|policy|cannot|can't|unable to|not able/.test(lower)) {
    return new AppError("CONTENT_REJECTED", userMessageFor("CONTENT_REJECTED"), { detail: text.slice(0, 200) });
  }
  return new AppError("NO_IMAGE_RETURNED", userMessageFor("NO_IMAGE_RETURNED"), {
    detail: text ? text.slice(0, 200) : `status=${status ?? "unknown"}`,
  });
}

export function userMessageFor(code: GenerationErrorCode): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "Connect a provider before generating.";
    case "AUTH_EXPIRED":
      return "Your Google session expired. Reconnect in Settings.";
    case "INVALID_CREDENTIAL":
      return "The provider rejected your credential.";
    case "PERMISSION_DENIED":
      return "Your account does not have access to this model or project.";
    case "RATE_LIMITED":
      return "Gemini rate limit reached. We'll retry automatically when possible.";
    case "QUOTA_EXCEEDED":
      return "Your Gemini quota is exhausted.";
    case "NETWORK_ERROR":
      return "Network error while contacting Gemini.";
    case "TIMEOUT":
      return "Gemini took too long to answer.";
    case "PROVIDER_UNAVAILABLE":
      return "Gemini is temporarily unavailable.";
    case "INVALID_REQUEST":
      return "Gemini rejected the request.";
    case "INVALID_IMAGE":
      return "Gemini could not process the source image.";
    case "UNSUPPORTED_FORMAT":
      return "This image format is not supported by Gemini.";
    case "MODEL_UNAVAILABLE":
      return "This model is not available for your account.";
    case "CONTENT_REJECTED":
      return "Gemini declined this prompt or image.";
    case "NO_IMAGE_RETURNED":
      return "Gemini answered without an image.";
    case "CANCELLED":
      return "Cancelled.";
    case "STORAGE_ERROR":
      return "The result could not be saved.";
    default:
      return "Something went wrong.";
  }
}
