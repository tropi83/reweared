import {
  CURRENT_SCHEMA_VERSION,
  summarize,
  type Generation,
  type GenerationJob,
  type ImageAsset,
  type Listing,
  type ListingDocument,
  type ListingSummary,
} from "@aiv/domain/models";
import type { generation, generationJob, imageAsset, listing } from "../db/schema";
import { toDomainJobStatus } from "../generations/runs";

type ListingRow = typeof listing.$inferSelect;
type ImageRow = typeof imageAsset.$inferSelect;
type GenerationRow = typeof generation.$inferSelect;
type JobRow = typeof generationJob.$inferSelect;

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

const iso = (d: Date | null) => (d ? d.toISOString() : undefined);

/** A photo-pack job as the clients know it (server states dispatched/active → queued/generating). */
export function toGenerationJob(row: JobRow): GenerationJob {
  const startedAt = iso(row.startedAt);
  const completedAt = iso(row.completedAt);
  return {
    id: row.id,
    listingId: row.listingId,
    generationId: row.generationId,
    sourceImageId: row.sourceImageId ?? "",
    index: row.index,
    prompt: row.prompt,
    ...(row.shotId ? { shotId: row.shotId } : {}),
    ...(row.shotLabel ? { shotLabel: row.shotLabel } : {}),
    provider: row.provider,
    model: row.model,
    aspectRatio: row.aspectRatio,
    ...(row.imageSize ? { imageSize: row.imageSize } : {}),
    ...(row.providerOptions ? { providerOptions: row.providerOptions } : {}),
    ...(row.seed !== null ? { seed: row.seed } : {}),
    status: toDomainJobStatus(row.status),
    attempt: row.attempt,
    ...(row.resultImageId ? { resultImageId: row.resultImageId } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

export function toGeneration(row: GenerationRow, jobs: JobRow[]): Generation {
  const completedAt = iso(row.completedAt);
  return {
    id: row.id,
    listingId: row.listingId,
    sourceImageId: row.sourceImageId ?? "",
    ...(row.parentGenerationId ? { parentGenerationId: row.parentGenerationId } : {}),
    prompt: row.prompt,
    ...(row.category ? { category: row.category } : {}),
    settings: row.settings,
    status: row.status,
    jobIds: jobs
      .filter((j) => j.generationId === row.id)
      .sort((a, b) => a.index - b.index || a.createdAt.getTime() - b.createdAt.getTime())
      .map((j) => j.id),
    createdAt: row.createdAt.toISOString(),
    ...(completedAt ? { completedAt } : {}),
  };
}

/** Photo-pack generations and their jobs are part of the document; listing-copy runs are not (the copy itself is). */
export function toDocument(row: ListingRow, images: ImageRow[], generations: GenerationRow[] = [], jobs: JobRow[] = []): ListingDocument {
  const packs = generations.filter((g) => g.kind === "images");
  const packJobs = jobs.filter((j) => j.kind === "images");
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: "server",
    listing: toListing(row),
    images: Object.fromEntries(images.map((i) => [i.id, toImageAsset(i)])),
    generations: Object.fromEntries(packs.map((g) => [g.id, toGeneration(g, packJobs)])),
    jobs: Object.fromEntries(packJobs.map((j) => [j.id, toGenerationJob(j)])),
    toPost: row.toPost,
  };
}

/** Same rules as the clients' `summarize` (cover = chosen cover, else the original; count of generated images). */
export function toSummary(row: ListingRow, images: ImageRow[]): ListingSummary {
  return summarize(toDocument(row, images));
}
