import { z } from "zod";
import { safeId, isoDateTime } from "./common";

export const CATEGORY_IDS = ["women", "men", "kids", "home", "electronics", "entertainment", "hobbies", "sport", "pets", "luxury"] as const;
export const LISTING_CONDITIONS = ["new_with_tags", "new", "very_good", "good", "satisfactory"] as const;
export const LOCALES = ["en", "fr"] as const;

export const categorySelection = z.strictObject({
  categoryId: z.enum(CATEGORY_IDS),
  subcategoryId: z.string().regex(/^[a-z0-9-]{1,40}$/),
});

export const listingCopy = z.strictObject({
  title: z.string().max(200),
  description: z.string().max(5000),
  condition: z.enum(LISTING_CONDITIONS).optional(),
  brand: z.string().max(60).optional(),
  color: z.string().max(40).optional(),
  keywords: z.array(z.string().max(40)).max(20),
  language: z.enum(LOCALES),
  generatedAt: isoDateTime,
  provider: z.string().max(40),
  model: z.string().max(120),
});

export const imageAssetDto = z.object({
  id: safeId,
  listingId: safeId,
  kind: z.enum(["original", "generation"]),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().nonnegative(),
  fileName: z.string().max(120).optional(),
  generationId: safeId.optional(),
  jobId: safeId.optional(),
  createdAt: isoDateTime,
});

export const listingDto = z.object({
  id: safeId,
  name: z.string().max(120),
  originalImageId: safeId.optional(),
  coverImageId: safeId.optional(),
  category: categorySelection.optional(),
  brand: z.string().max(60).optional(),
  useMannequin: z.boolean().optional(),
  copy: listingCopy.optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/**
 * The `ListingDocument` shape the clients already use. Generations and jobs are produced by the worker
 * (phase 2); until then they are empty records and their schemas are not pinned here.
 */
export const listingDocumentDto = z.object({
  schemaVersion: z.number().int(),
  appVersion: z.string(),
  listing: listingDto,
  images: z.record(safeId, imageAssetDto),
  generations: z.record(safeId, z.unknown()),
  jobs: z.record(safeId, z.unknown()),
  toPost: z.array(safeId),
});

export const listingSummaryDto = z.object({
  id: safeId,
  name: z.string(),
  coverImageId: safeId.optional(),
  category: categorySelection.optional(),
  imageCount: z.number().int().nonnegative(),
  updatedAt: isoDateTime,
});

export const createListingBody = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
});

/** Partial update of a listing; `null` clears an optional field. Unknown keys are refused. */
export const patchListingBody = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  category: categorySelection.nullable().optional(),
  brand: z.string().max(60).nullable().optional(),
  useMannequin: z.boolean().optional(),
  copy: listingCopy.nullable().optional(),
  coverImageId: safeId.nullable().optional(),
  toPost: z.array(safeId).max(100).optional(),
});
