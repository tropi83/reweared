import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, type AppSettings, type ListingDocument } from "@/domain/models";

type ListingMigration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Ordered listing migrations, keyed by the version they upgrade FROM.
 * v0 -> v1: nothing yet; the slot documents the pattern.
 */
const LISTING_MIGRATIONS: Record<number, ListingMigration> = {
  0: (doc) => ({ ...doc, schemaVersion: 1, favorites: Array.isArray(doc.favorites) ? doc.favorites : [] }),
  // v1 -> v2: "favourites" became the "to post" marking used by the Vinted publishing flow.
  1: ({ favorites, ...doc }) => ({ ...doc, schemaVersion: 2, toPost: Array.isArray(favorites) ? favorites : [] }),
  // v2 -> v3: the aggregate "project" became "listing"; its category selection, once called `listing`, is
  // `category`; every `projectId` is a `listingId`.
  2: ({ project, ...doc }) => {
    const { listing: category, ...aggregate } = (project ?? {}) as Record<string, unknown>;
    const relabel = (records: unknown, extra?: (r: Record<string, unknown>) => Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries((records ?? {}) as Record<string, Record<string, unknown>>).map(([id, record]) => {
          const { projectId, ...rest } = record;
          const next = { ...rest, listingId: projectId };
          return [id, extra ? extra(next) : next];
        }),
      );
    return {
      ...doc,
      schemaVersion: 3,
      listing: { ...aggregate, ...(category ? { category } : {}) },
      images: relabel(doc.images),
      generations: relabel(doc.generations, ({ listing, ...gen }) => ({ ...gen, ...(listing ? { category: listing } : {}) })),
      jobs: relabel(doc.jobs),
    };
  },
};

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export function migrateListingDocument(raw: unknown): ListingDocument {
  if (typeof raw !== "object" || raw === null) throw new MigrationError("Listing document is not an object");
  let doc = raw as Record<string, unknown>;
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(`Listing was saved by a newer version (schema ${version}).`);
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = LISTING_MIGRATIONS[version];
    if (!migrate) throw new MigrationError(`No migration from schema ${version}`);
    doc = migrate(doc);
    version = doc.schemaVersion as number;
  }
  const result = doc as unknown as ListingDocument;
  if (!result.listing?.id) throw new MigrationError("Listing document has no listing id");
  result.images ??= {};
  result.generations ??= {};
  result.jobs ??= {};
  result.toPost ??= [];
  return result;
}

export function migrateSettings(raw: unknown): AppSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<AppSettings>), schemaVersion: SETTINGS_SCHEMA_VERSION };
  merged.maxConcurrentJobs = clamp(merged.maxConcurrentJobs, 1, 8);
  merged.maxAttempts = clamp(merged.maxAttempts, 1, 6);
  merged.jobTimeoutMs = clamp(merged.jobTimeoutMs, 15_000, 600_000);
  merged.defaultVariationCount = clamp(merged.defaultVariationCount, 1, 8);
  merged.prepareMaxDimension = clamp(merged.prepareMaxDimension, 512, 8192);
  return merged;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
