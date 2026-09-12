import type { Generation, GenerationJob } from "./generation";
import type { ImageAsset } from "./image";
import type { ListingCopy, CategorySelection } from "./catalog";

/** Bump when the on-disk shape of ListingDocument changes; add a migration in storage/migrations.ts. */
export const CURRENT_SCHEMA_VERSION = 3;

export interface Listing {
  id: string;
  name: string;
  /** Imported original. Undefined for an empty listing. */
  originalImageId?: string;
  /** Asset shown as listing cover in the sidebar. */
  coverImageId?: string;
  /** Marketplace taxonomy chosen for this item. */
  category?: CategorySelection;
  /** Brand typed by the seller (raw, max 60 chars); trimmed when used. Absent = no brand stated. */
  brand?: string;
  /** "My mannequin" toggle for this listing's photos with a person. */
  useMannequin?: boolean;
  /** Title/description generated from the original photo, edited by the user. */
  copy?: ListingCopy;
  createdAt: string;
  updatedAt: string;
}

/**
 * Everything about one listing, persisted as a single `listing.json`.
 * Image bytes are stored separately (see StorageProvider).
 */
export interface ListingDocument {
  schemaVersion: number;
  appVersion: string;
  listing: Listing;
  images: Record<string, ImageAsset>;
  generations: Record<string, Generation>;
  jobs: Record<string, GenerationJob>;
  /** Asset ids the user marked "À publier" (photos to post on the marketplace). */
  toPost: string[];
}

export interface ListingSummary {
  id: string;
  name: string;
  coverImageId?: string;
  /** Chosen taxonomy, so lists can show its icon. */
  category?: CategorySelection;
  imageCount: number;
  updatedAt: string;
}

export function summarize(doc: ListingDocument): ListingSummary {
  const cover = doc.listing.coverImageId ?? doc.listing.originalImageId;
  return {
    id: doc.listing.id,
    name: doc.listing.name,
    ...(cover ? { coverImageId: cover } : {}),
    ...(doc.listing.category ? { category: doc.listing.category } : {}),
    imageCount: Object.values(doc.images).filter((i) => i.kind === "generation").length,
    updatedAt: doc.listing.updatedAt,
  };
}
