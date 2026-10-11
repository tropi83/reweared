import { z } from "zod";
import { SAFE_ID_PATTERN } from "@aiv/domain/lib/ids";

/** An id produced by `createId()` (listing, image, generation, job, recipe). */
export const safeId = z.string().regex(SAFE_ID_PATTERN, "invalid id");

export const isoDateTime = z.iso.datetime({ offset: true });

/** Every error body: a stable code for the client and a user-safe message (never a stack trace or a secret). */
export const errorBody = z.object({
  code: z.string().min(1),
  message: z.string(),
});
