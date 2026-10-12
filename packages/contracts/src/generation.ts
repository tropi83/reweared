import { z } from "zod";
import { GENERATION_ERROR_CODES } from "@aiv/domain/models";
import { isoDateTime, safeId } from "./common";
import { categorySelection, LOCALES } from "./shared";

export const ASPECT_RATIOS = ["original", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
const imageSizes = z.enum(["512px", "1K", "2K", "4K"]);
const providerOptions = z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean()]));

export const generationErrorDto = z.object({
  code: z.enum(GENERATION_ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  retryAfterMs: z.number().optional(),
  detail: z.string().optional(),
});

export const generationJobDto = z.object({
  id: safeId,
  listingId: safeId,
  generationId: safeId,
  sourceImageId: safeId,
  index: z.number().int().nonnegative(),
  prompt: z.string(),
  shotId: z.string().optional(),
  shotLabel: z.object({ en: z.string(), fr: z.string() }).optional(),
  provider: z.string(),
  model: z.string(),
  aspectRatio: z.enum(ASPECT_RATIOS),
  imageSize: imageSizes.optional(),
  providerOptions: providerOptions.optional(),
  seed: z.number().int().optional(),
  status: z.enum(["queued", "generating", "completed", "failed", "cancelled"]),
  attempt: z.number().int().nonnegative(),
  resultImageId: safeId.optional(),
  error: generationErrorDto.optional(),
  nextRetryAt: isoDateTime.optional(),
  createdAt: isoDateTime,
  startedAt: isoDateTime.optional(),
  completedAt: isoDateTime.optional(),
});

export const generationDto = z.object({
  id: safeId,
  listingId: safeId,
  sourceImageId: safeId,
  parentGenerationId: safeId.optional(),
  prompt: z.string(),
  recipeId: z.string().optional(),
  category: categorySelection.optional(),
  settings: z.object({
    providerId: z.string(),
    modelId: z.string(),
    aspectRatio: z.enum(ASPECT_RATIOS),
    imageSize: imageSizes.optional(),
    providerOptions: providerOptions.optional(),
    variationCount: z.number().int().positive(),
  }),
  status: z.enum(["active", "completed", "partial", "failed", "cancelled"]),
  jobIds: z.array(safeId),
  createdAt: isoDateTime,
  completedAt: isoDateTime.optional(),
});

/** Start the listing's photo pack. Provider and model are the platform's; only per-run options are accepted. */
export const startGenerationBody = z.strictObject({
  sourceImageId: safeId.optional(),
  shotIds: z
    .array(z.string().regex(/^[a-z0-9-]{1,40}$/))
    .min(1)
    .max(10)
    .optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  options: providerOptions.optional(),
});

/** Write the listing's title and description from its original photo. */
export const startCopyBody = z.strictObject({ language: z.enum(LOCALES) });

export const startedRunDto = z.object({
  generationId: safeId,
  kind: z.enum(["images", "copy"]),
  jobIds: z.array(safeId),
  credits: z.number().int().nonnegative(),
});
