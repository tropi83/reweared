import { z } from "zod";
import { isoDateTime } from "./common";

export const creditEntryDto = z.object({
  delta: z.number().int(),
  reason: z.enum(["grant", "reserve", "refund", "adjust"]),
  generationId: z.string().optional(),
  jobId: z.string().optional(),
  createdAt: isoDateTime,
});

/** The account's credits: balance, plan and the latest movements (newest first). */
export const creditsDto = z.object({
  balance: z.number().int().nonnegative(),
  plan: z.string(),
  ledger: z.array(creditEntryDto),
});
