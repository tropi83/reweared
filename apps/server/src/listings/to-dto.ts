import { CURRENT_SCHEMA_VERSION, summarize, type ImageAsset, type Listing, type ListingDocument, type ListingSummary } from "@aiv/domain/models";
import type { imageAsset, listing } from "../db/schema";

type ListingRow = typeof listing.$inferSelect;
type ImageRow = typeof imageAsset.$inferSelect;

/** Database rows → the `ListingDocument` the clients already know (optional fields omitted when null). */
export function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    name: row.name,
    ...(row.originalImageId ? { originalImageId: row.originalImageId } : {}),
    ...(row.coverImageId ? { coverImageId: row.coverImageId } : {}),
    ...(row.category ? { category: row.category } : {}),
    ...(row.brand !== null ? { brand: row.brand } : {}),
    useMannequin: row.useMannequin,
    ...(row.copy ? { copy: row.copy } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toImageAsset(row: ImageRow): ImageAsset {
  return {
    id: row.id,
    listingId: row.listingId,
    kind: row.kind,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    byteSize: row.byteSize,
    ...(row.fileName ? { fileName: row.fileName } : {}),
    ...(row.generationId ? { generationId: row.generationId } : {}),
    ...(row.jobId ? { jobId: row.jobId } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Generations and jobs are produced by the worker (phase 2); until then they are empty. */
export function toDocument(row: ListingRow, images: ImageRow[]): ListingDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: "server",
    listing: toListing(row),
    images: Object.fromEntries(images.map((i) => [i.id, toImageAsset(i)])),
    generations: {},
    jobs: {},
    toPost: row.toPost,
  };
}

/** Same rules as the clients' `summarize` (cover = chosen cover, else the original; count of generated images). */
export function toSummary(row: ListingRow, images: ImageRow[]): ListingSummary {
  return summarize(toDocument(row, images));
}
