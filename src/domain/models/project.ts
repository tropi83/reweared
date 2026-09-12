import type { Generation, GenerationJob } from "./generation";
import type { ImageAsset } from "./image";
import type { ListingCopy, ListingSelection } from "./listing";

/** Bump when the on-disk shape of ProjectDocument changes; add a migration in storage/migrations.ts. */
export const CURRENT_SCHEMA_VERSION = 2;

export interface Project {
  id: string;
  name: string;
  /** Imported original. Undefined for an empty project. */
  originalImageId?: string;
  /** Asset shown as project cover in the sidebar. */
  coverImageId?: string;
  /** Marketplace taxonomy chosen for this item. */
  listing?: ListingSelection;
  /** Title/description generated from the original photo, edited by the user. */
  copy?: ListingCopy;
  createdAt: string;
  updatedAt: string;
}

/**
 * Everything about one project, persisted as a single `project.json`.
 * Image bytes are stored separately (see StorageProvider).
 */
export interface ProjectDocument {
  schemaVersion: number;
  appVersion: string;
  project: Project;
  images: Record<string, ImageAsset>;
  generations: Record<string, Generation>;
  jobs: Record<string, GenerationJob>;
  /** Asset ids the user marked "À publier" (photos to post on the marketplace). */
  toPost: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  coverImageId?: string;
  imageCount: number;
  updatedAt: string;
}

export function summarize(doc: ProjectDocument): ProjectSummary {
  const cover = doc.project.coverImageId ?? doc.project.originalImageId;
  return {
    id: doc.project.id,
    name: doc.project.name,
    ...(cover ? { coverImageId: cover } : {}),
    imageCount: Object.values(doc.images).filter((i) => i.kind === "generation").length,
    updatedAt: doc.project.updatedAt,
  };
}
