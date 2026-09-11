import { AppError, type GenerationErrorCode } from "@/domain/models";
import type { CloudflareErrorBody } from "./CloudflareMapper";

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
  switch (status) {
    case 400:
      // Cloudflare answers bad tokens with 400 + code 9106/10000 "Authentication failed/error".
      if (/authentication|authorization|api token|invalid token/.test(lower) || first?.code === 9106 || first?.code === 10000) code = "INVALID_CREDENTIAL";
      else if (/image|b64|base64|decode|dimension|width|height/.test(lower)) code = "INVALID_IMAGE";
      else if (/nsfw|safety|policy|prohibited|blocked/.test(lower)) code = "CONTENT_REJECTED";
      else code = "INVALID_REQUEST";
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
      code = /neuron|daily|quota|allocation|exceeded your/.test(lower) && !/per minute|rate limit/.test(lower) ? "QUOTA_EXCEEDED" : "RATE_LIMITED";
      break;
    default:
      code = status >= 500 ? "PROVIDER_UNAVAILABLE" : "UNKNOWN_ERROR";
  }
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  return new AppError(code, cloudflareMessageFor(code), {
    detail,
    ...(Number.isFinite(seconds) ? { retryAfterMs: Math.max(0, seconds * 1000) } : {}),
  });
}

/** A 200 whose body is the v4 JSON envelope with success:false, or an unexpected content type. */
export function mapCloudflareEnvelopeError(body: CloudflareErrorBody): AppError {
  const first = body.errors?.[0];
  const message = first?.message ?? "Cloudflare returned an unsuccessful response.";
  const lower = message.toLowerCase();
  const code: GenerationErrorCode = /nsfw|safety|policy/.test(lower)
    ? "CONTENT_REJECTED"
    : /image|b64|base64|decode/.test(lower)
      ? "INVALID_IMAGE"
      : "INVALID_REQUEST";
  return new AppError(code, cloudflareMessageFor(code), { detail: `${first?.code ?? "-"}: ${message.slice(0, 400)}` });
}

export function cloudflareMessageFor(code: GenerationErrorCode): string {
  switch (code) {
    case "INVALID_CREDENTIAL":
      return "Cloudflare rejected the account ID or API token.";
    case "RATE_LIMITED":
      return "Cloudflare Workers AI rate limit reached. We'll retry automatically.";
    case "QUOTA_EXCEEDED":
      return "Your Workers AI daily allocation is exhausted.";
    case "MODEL_UNAVAILABLE":
      return "This Workers AI model is not available.";
    case "MODEL_NOT_IN_PLAN":
      return "Cloudflare does not allow your account to use this model (private/restricted model). Pick another model.";
    case "INVALID_IMAGE":
      return "Cloudflare could not process the source image.";
    case "CONTENT_REJECTED":
      return "Cloudflare declined this prompt or image.";
    case "PROVIDER_UNAVAILABLE":
      return "Cloudflare Workers AI is temporarily unavailable.";
    case "INVALID_REQUEST":
      return "Cloudflare rejected the request.";
    default:
      return "Something went wrong with Cloudflare Workers AI.";
  }
}
