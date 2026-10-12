import { z } from "zod";
import { SAFE_ID_PATTERN } from "@aiv/domain/lib/ids";

/** An id produced by `createId()` (listing, image, generation, job, recipe). */
export const safeId = z.string().regex(SAFE_ID_PATTERN, "invalid id");

export const isoDateTime = z.iso.datetime({ offset: true });

/** Codes the API answers with besides `GenerationErrorCode`. */
export const HTTP_ERROR_CODES = [
  "UNAUTHENTICATED",
  "EMAIL_NOT_VERIFIED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "INSUFFICIENT_CREDITS",
  "PROVIDER_BUDGET_EXHAUSTED",
  "CONFLICT",
  "UNKNOWN_ERROR",
] as const;
export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];

/** Every error body: a stable code for the client and a user-safe message (never a stack trace or a secret). */
export const errorBody = z.object({
  code: z.string().min(1),
  message: z.string(),
});

/** Path parameter of every `/:id` route: only ids produced by `createId()` reach a query or an object key. */
export const idParams = z.strictObject({ id: safeId });
