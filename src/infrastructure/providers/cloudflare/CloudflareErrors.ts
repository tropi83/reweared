import { AppError, type GenerationErrorCode } from "@/domain/models";
import type { CloudflareErrorBody } from "./CloudflareMapper";

interface Classified {
  code: GenerationErrorCode;
  retryable?: boolean;
}

/**
 * "The model refused this input" answers. Cloudflare reuses code 3030 for several of them, so the
 * message decides, and content-filter wording is checked first: the safety filter's answer ("Your
 * output has been flagged. Please choose another prompt / input image combination") also mentions
 * "input image". An output flag comes from the safety checker judging the *generated* image — another
 * seed usually passes (false positives are frequent on plain product shots), so it is retryable; a
 * refusal of the prompt or source image itself is not.
 */
export function classifyRejectedInput(message: string): Classified {
  const lower = message.toLowerCase();
  if (/output[^.]*flagged/.test(lower)) return { code: "CONTENT_REJECTED", retryable: true };
  if (/flagged|nsfw|safety|policy|prohibited|blocked|moderat/.test(lower)) return { code: "CONTENT_REJECTED", retryable: false };
  if (/image|b64|base64|decode|dimension|width|height/.test(lower)) return { code: "INVALID_IMAGE" };
  return { code: "INVALID_REQUEST" };
}

/**
 * Maps a Cloudflare API failure (`{ success:false, errors:[{code,message}] }`, standard Cloudflare
 * v4 envelope) to the app's error vocabulary. Messages never contain the token.
 */
export function mapCloudflareHttpError(status: number, body: CloudflareErrorBody | string | undefined, retryAfter: string | null): AppError {
  const errors = typeof body === "object" && body ? (body.errors ?? []) : [];
  const first = errors[0];
  const message = first?.message ?? (typeof body === "string" ? body.slice(0, 300) : "");
  const lower = message.toLowerCase();
  const detail = `HTTP ${status}${first?.code !== undefined ? ` (${first.code})` : ""}${message ? `: ${message.slice(0, 400)}` : ""}`;

  let code: GenerationErrorCode;
  let retryable: boolean | undefined;
  switch (status) {
    case 400:
      // Cloudflare answers bad tokens with 400 + code 9106/10000 "Authentication failed/error".
      if (/authentication|authorization|api token|invalid token/.test(lower) || first?.code === 9106 || first?.code === 10000) code = "INVALID_CREDENTIAL";
      else ({ code, retryable } = classifyRejectedInput(message));
      break;
    case 401:
      code = "INVALID_CREDENTIAL";
      break;
    case 403:
      // 5018 / 3041 "The account is not allowed to access this model" (private model) — the token is fine.
      code = first?.code === 5018 || first?.code === 3041 || /not allowed to access/.test(lower) ? "MODEL_NOT_IN_PLAN" : "INVALID_CREDENTIAL";
      break;
    case 404:
      // 7003 "Could not route to …, perhaps your object identifier is invalid" = bad account id;
      // "No such model" = unknown model id.
      code = /model/.test(lower) && !/route/.test(lower) ? "MODEL_UNAVAILABLE" : "INVALID_CREDENTIAL";
      break;
    case 413:
      code = "INVALID_IMAGE";
      break;
    case 429:
      // 4006 "you have used up your daily free allocation" = the 10,000 free neurons are gone until 00:00 UTC
      // (not retryable today); anything else is per-minute throttling.
      code =
        first?.code === 4006 || (/neuron|daily|quota|allocation|exceeded your/.test(lower) && !/per minute|rate limit/.test(lower))
          ? "QUOTA_EXCEEDED"
          : "RATE_LIMITED";
      break;
    default:
      code = status >= 500 ? "PROVIDER_UNAVAILABLE" : "UNKNOWN_ERROR";
  }
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  return new AppError(code, cloudflareMessageFor(code), {
    detail,
    ...(retryable !== undefined ? { retryable } : {}),
    ...(Number.isFinite(seconds) ? { retryAfterMs: Math.max(0, seconds * 1000) } : {}),
  });
}

/** A 200 whose body is the v4 JSON envelope with success:false, or an unexpected content type. */
export function mapCloudflareEnvelopeError(body: CloudflareErrorBody): AppError {
  const first = body.errors?.[0];
  const message = first?.message ?? "Cloudflare returned an unsuccessful response.";
  const { code, retryable } = classifyRejectedInput(message);
  return new AppError(code, cloudflareMessageFor(code), {
    detail: `${first?.code ?? "-"}: ${message.slice(0, 400)}`,
    ...(retryable !== undefined ? { retryable } : {}),
  });
}

export function cloudflareMessageFor(code: GenerationErrorCode): string {
  switch (code) {
    case "INVALID_CREDENTIAL":
      return "Cloudflare rejected the account ID or API token.";
    case "RATE_LIMITED":
      return "Cloudflare Workers AI rate limit reached. We'll retry automatically.";
    case "QUOTA_EXCEEDED":
      return "Your free daily Workers AI allocation is used up; it resets at 00:00 UTC.";
    case "MODEL_UNAVAILABLE":
      return "This Workers AI model is not available.";
    case "MODEL_NOT_IN_PLAN":
      return "Cloudflare does not allow your account to use this model (private/restricted model). Pick another model.";
    case "INVALID_IMAGE":
      return "Cloudflare could not process the source image.";
    case "CONTENT_REJECTED":
      return "Cloudflare's safety filter blocked this image (often a false positive). Retry: each attempt uses a new seed.";
    case "PROVIDER_UNAVAILABLE":
      return "Cloudflare Workers AI is temporarily unavailable.";
    case "INVALID_REQUEST":
      return "Cloudflare rejected the request.";
    default:
      return "Something went wrong with Cloudflare Workers AI.";
  }
}
