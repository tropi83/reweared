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

export type QuotaWindow = "minute" | "day" | "other";

export interface QuotaViolation {
  quotaId: string;
  quotaMetric?: string;
  /** Limit value as reported by Google ("0" means the model is not part of the plan). */
  quotaValue?: number;
  model?: string;
  window: QuotaWindow;
}

export interface QuotaInfo {
  violations: QuotaViolation[];
  /** From google.rpc.RetryInfo, when present. */
  retryDelayMs?: number;
  /** True when the exhausted metric is a free-tier bucket (the project has no billing linked). */
  freeTier: boolean;
}

/** Google's own usage/quota dashboard, referenced by its 429 messages and the rate-limits docs. */
export const GOOGLE_RATE_LIMIT_DASHBOARD = "https://aistudio.google.com/rate-limit";

const QUOTA_LINE = /metric:\s*([\w./-]+),\s*limit:\s*(\d+)(?:,\s*model:\s*([\w.-]+))?/g;

function windowOf(quotaId: string): QuotaWindow {
  if (/perminute|persecond/i.test(quotaId)) return "minute";
  if (/perday/i.test(quotaId)) return "day";
  return "other";
}

/** Parses the structured quota information Google attaches to 429 responses. */
export function parseQuotaInfo(body: GeminiErrorBody | undefined): QuotaInfo {
  const info: QuotaInfo = { violations: [], freeTier: false };
  for (const detail of body?.error?.details ?? []) {
    const type = detail["@type"] ?? "";
    if (type.endsWith("QuotaFailure")) {
      for (const v of detail.violations ?? []) {
        const quotaId = v.quotaId ?? "";
        const value = v.quotaValue !== undefined ? Number(v.quotaValue) : undefined;
        info.violations.push({
          quotaId,
          ...(v.quotaMetric ? { quotaMetric: v.quotaMetric } : {}),
          ...(value !== undefined && Number.isFinite(value) ? { quotaValue: value } : {}),
          ...(v.quotaDimensions?.model ? { model: v.quotaDimensions.model } : {}),
          window: windowOf(quotaId),
        });
      }
    } else if (type.endsWith("RetryInfo") && detail.retryDelay) {
      const seconds = Number(String(detail.retryDelay).replace(/s$/, ""));
      if (Number.isFinite(seconds)) info.retryDelayMs = Math.max(0, Math.round(seconds * 1000));
    }
  }
  // Fallback: Google also spells the violations out in the message ("metric: …, limit: N, model: …").
  if (info.violations.length === 0) {
    for (const match of (body?.error?.message ?? "").matchAll(QUOTA_LINE)) {
      const [, metric, limit, model] = match;
      info.violations.push({
        quotaId: metric ?? "",
        ...(metric ? { quotaMetric: metric } : {}),
        quotaValue: Number(limit),
        ...(model ? { model } : {}),
        window: /per_day|perday/i.test(metric ?? "") ? "day" : /per_minute|perminute/i.test(metric ?? "") ? "minute" : "other",
      });
    }
  }
  info.freeTier = info.violations.some((v) => /free_tier|freetier/i.test(`${v.quotaMetric ?? ""} ${v.quotaId}`));
  return info;
}

/**
 * Classifies a 429. Google uses the same "You exceeded your current quota" wording for
 * per-minute throttling (retry soon), daily exhaustion (wait for the reset) and models that
 * are simply not part of the plan (limit 0), so the structured details decide.
 */
function classify429(quota: QuotaInfo, lower: string): GenerationErrorCode {
  if (quota.violations.some((v) => v.quotaValue === 0)) return "MODEL_NOT_IN_PLAN";
  if (quota.violations.some((v) => v.window === "day")) return "QUOTA_EXCEEDED";
  if (quota.violations.some((v) => v.window === "minute")) return "RATE_LIMITED";
  if (quota.retryDelayMs !== undefined) return quota.retryDelayMs <= 120_000 ? "RATE_LIMITED" : "QUOTA_EXCEEDED";
  if (/per minute|per second|too many requests/.test(lower)) return "RATE_LIMITED";
  if (/billing|plan/.test(lower)) return "QUOTA_EXCEEDED";
  return "RATE_LIMITED";
}

/**
 * Normalizes an HTTP failure from the Gemini API. The raw message is kept only in `detail`
 * (truncated) and never contains credentials since Google does not echo them back.
 */
export function mapGeminiHttpError(status: number, body: GeminiErrorBody | undefined, retryAfter: string | null): AppError {
  const message = body?.error?.message ?? "";
  const googleStatus = body?.error?.status ?? "";
  const lower = message.toLowerCase();
  const quota = parseQuotaInfo(body);
  const quotaSummary = quota.violations.map((v) => `${v.quotaId}${v.quotaValue !== undefined ? `=${v.quotaValue}` : ""}`).join(", ");
  const detail = `HTTP ${status}${googleStatus ? ` ${googleStatus}` : ""}${message ? `: ${message.slice(0, 400)}` : ""}${quotaSummary ? ` [${quotaSummary}]` : ""}`;

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
      code = classify429(quota, lower);
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

  const retryAfterMs = quota.retryDelayMs ?? parseRetryAfter(retryAfter);
  const finalCode: GenerationErrorCode = code === "MODEL_NOT_IN_PLAN" && quota.freeTier ? "FREE_TIER_NO_ACCESS" : code;
  return new AppError(finalCode, userMessageFor(finalCode), {
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
      return "Your Gemini quota for this model is exhausted for today.";
    case "MODEL_NOT_IN_PLAN":
      return "This model is not included in your Google plan (limit 0).";
    case "FREE_TIER_NO_ACCESS":
      return "Your Google project is on the Free tier, which has no quota for this model. Link a billing account to use it.";
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
