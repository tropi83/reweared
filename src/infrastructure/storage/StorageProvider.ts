import type { AppSettings, ProjectDocument, ProjectSummary, Recipe } from "@/domain/models";

/** Which bytes bucket an image belongs to. Thumbnails share the asset id of their full image. */
export type ImageBucket = "original" | "generation" | "thumbnail";

export interface StorageUsage {
  projectCount: number;
  /** Approximate bytes used by image files. */
  imageBytes: number;
  /** Human-readable location, for the Settings page. */
  location: string;
}

/**
 * Persistence boundary. Metadata is JSON documents; image bytes are opaque blobs.
 *
 * Implementations: IndexedDbStorage (web), TauriFsStorage (desktop/mobile), MemoryStorage (tests).
 * Swapping to SQLite later means adding one more implementation, nothing in the domain changes.
 */
export interface StorageProvider {
  init(): Promise<void>;

  listProjects(): Promise<ProjectSummary[]>;
  getProject(projectId: string): Promise<ProjectDocument | null>;
  saveProject(doc: ProjectDocument): Promise<void>;
  deleteProject(projectId: string): Promise<void>;

  writeImage(projectId: string, bucket: ImageBucket, assetId: string, blob: Blob): Promise<void>;
  readImage(projectId: string, bucket: ImageBucket, assetId: string): Promise<Blob | null>;
  deleteImage(projectId: string, bucket: ImageBucket, assetId: string): Promise<void>;
  /** Removes image files no longer referenced by the project document. Returns the count removed. */
  cleanupOrphans(projectId: string): Promise<number>;

  getSettings(): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;

  listRecipes(): Promise<Recipe[]>;
  saveRecipe(recipe: Recipe): Promise<void>;
  deleteRecipe(recipeId: string): Promise<void>;

  getUsage(): Promise<StorageUsage>;
  /** Wipes every project, image, recipe and setting. */
  clearAll(): Promise<void>;
}
