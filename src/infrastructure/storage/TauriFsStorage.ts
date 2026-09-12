import { summarize, type AppSettings, type ListingDocument, type ListingSummary, type Recipe } from "@/domain/models";
import { assertSafeId } from "@/lib/ids";
import { createLogger } from "@/lib/logger";
import { migrateListingDocument, migrateSettings } from "./migrations";
import type { ImageBucket, StorageProvider, StorageUsage } from "./StorageProvider";

const log = createLogger("fs-storage");

type FsModule = typeof import("@tauri-apps/plugin-fs");

const BUCKET_DIR: Record<ImageBucket, string> = { original: "original", generation: "generations", thumbnail: "thumbnails" };
const EXTENSIONS = ["webp", "png", "jpg"] as const;

function extFor(mime: string): (typeof EXTENSIONS)[number] {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  return "webp";
}

/**
 * Desktop / mobile storage on the real filesystem, under the Tauri app-data directory:
 *
 *   listings/<listingId>/listing.json
 *   listings/<listingId>/original/<assetId>.<ext>
 *   listings/<listingId>/generations/<assetId>.<ext>
 *   listings/<listingId>/thumbnails/<assetId>.<ext>
 *   recipes/<recipeId>.json
 *   settings.json
 *
 * All paths are relative to BaseDirectory.AppData and every id passes assertSafeId, so no
 * user-controlled string can escape the app directory. The Tauri fs scope in
 * capabilities/default.json is limited to $APPDATA/** as a second barrier.
 */
export class TauriFsStorage implements StorageProvider {
  private fs: FsModule | null = null;
  private base!: number;
  private locationLabel = "";

  async init(): Promise<void> {
    if (this.fs) return;
    const fs = await import("@tauri-apps/plugin-fs");
    const path = await import("@tauri-apps/api/path");
    this.fs = fs;
    this.base = fs.BaseDirectory.AppData;
    this.locationLabel = await path.appDataDir();
    await this.migrateLayout();
    await fs.mkdir("listings", { baseDir: this.base, recursive: true });
    await fs.mkdir("recipes", { baseDir: this.base, recursive: true });
    await fs.mkdir("metadata", { baseDir: this.base, recursive: true });
  }

  /**
   * 2026-09-13: `projects/<id>/project.json` became `listings/<id>/listing.json`. Runs once, before the
   * directories are created; the JSON content itself is migrated on read (schema v3).
   */
  private async migrateLayout(): Promise<void> {
    const fs = this.api;
    if (!(await fs.exists("projects", this.opts())) || (await fs.exists("listings", this.opts()))) return;
    log.info("migrating storage layout projects/ -> listings/");
    await fs.rename("projects", "listings", { oldPathBaseDir: this.base, newPathBaseDir: this.base });
    for (const entry of await fs.readDir("listings", this.opts())) {
      if (!entry.isDirectory) continue;
      const dir = `listings/${assertSafeId(entry.name)}`;
      if (await fs.exists(`${dir}/project.json`, this.opts())) {
        await fs.rename(`${dir}/project.json`, `${dir}/listing.json`, { oldPathBaseDir: this.base, newPathBaseDir: this.base });
      }
    }
  }

  private get api(): FsModule {
    if (!this.fs) throw new Error("Storage not initialized");
    return this.fs;
  }

  private opts() {
    return { baseDir: this.base };
  }

  private listingDir(listingId: string): string {
    return `listings/${assertSafeId(listingId)}`;
  }

  private async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    const tmp = `${path}.tmp`;
    await this.api.writeTextFile(tmp, JSON.stringify(value, null, 2), this.opts());
    if (await this.api.exists(path, this.opts())) await this.api.remove(path, this.opts());
    await this.api.rename(tmp, path, { oldPathBaseDir: this.base, newPathBaseDir: this.base });
  }

  async listListings(): Promise<ListingSummary[]> {
    const entries = await this.api.readDir("listings", this.opts());
    const summaries: ListingSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const doc = await this.getListing(entry.name).catch((err) => {
        log.warn("unreadable listing", entry.name, err);
        return null;
      });
      if (doc) summaries.push(summarize(doc));
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getListing(listingId: string): Promise<ListingDocument | null> {
    const file = `${this.listingDir(listingId)}/listing.json`;
    if (!(await this.api.exists(file, this.opts()))) return null;
    const text = await this.api.readTextFile(file, this.opts());
    return migrateListingDocument(JSON.parse(text));
  }

  async saveListing(doc: ListingDocument): Promise<void> {
    const dir = this.listingDir(doc.listing.id);
    await this.api.mkdir(dir, { ...this.opts(), recursive: true });
    await this.writeJsonAtomic(`${dir}/listing.json`, doc);
  }

  async deleteListing(listingId: string): Promise<void> {
    const dir = this.listingDir(listingId);
    if (await this.api.exists(dir, this.opts())) await this.api.remove(dir, { ...this.opts(), recursive: true });
  }

  private async findImagePath(listingId: string, bucket: ImageBucket, assetId: string): Promise<string | null> {
    const dir = `${this.listingDir(listingId)}/${BUCKET_DIR[bucket]}`;
    for (const ext of EXTENSIONS) {
      const candidate = `${dir}/${assertSafeId(assetId)}.${ext}`;
      if (await this.api.exists(candidate, this.opts())) return candidate;
    }
    return null;
  }

  async writeImage(listingId: string, bucket: ImageBucket, assetId: string, blob: Blob): Promise<void> {
    const dir = `${this.listingDir(listingId)}/${BUCKET_DIR[bucket]}`;
    await this.api.mkdir(dir, { ...this.opts(), recursive: true });
    const existing = await this.findImagePath(listingId, bucket, assetId);
    if (existing) await this.api.remove(existing, this.opts());
    const target = `${dir}/${assertSafeId(assetId)}.${extFor(blob.type)}`;
    await this.api.writeFile(target, new Uint8Array(await blob.arrayBuffer()), this.opts());
  }

  async readImage(listingId: string, bucket: ImageBucket, assetId: string): Promise<Blob | null> {
    const path = await this.findImagePath(listingId, bucket, assetId);
    if (!path) return null;
    const bytes = await this.api.readFile(path, this.opts());
    const ext = path.slice(path.lastIndexOf(".") + 1);
    const type = ext === "jpg" ? "image/jpeg" : ext === "png" ? "image/png" : "image/webp";
    return new Blob([bytes], { type });
  }

  async deleteImage(listingId: string, bucket: ImageBucket, assetId: string): Promise<void> {
    const path = await this.findImagePath(listingId, bucket, assetId);
    if (path) await this.api.remove(path, this.opts());
  }

  async cleanupOrphans(listingId: string): Promise<number> {
    const doc = await this.getListing(listingId);
    let removed = 0;
    for (const bucket of Object.values(BUCKET_DIR)) {
      const dir = `${this.listingDir(listingId)}/${bucket}`;
      if (!(await this.api.exists(dir, this.opts()))) continue;
      for (const entry of await this.api.readDir(dir, this.opts())) {
        if (!entry.isFile) continue;
        const assetId = entry.name.replace(/\.[a-z]+$/, "");
        const referenced = doc !== null && assetId in doc.images;
        if (!referenced || entry.name.endsWith(".tmp")) {
          await this.api.remove(`${dir}/${entry.name}`, this.opts());
          removed++;
        }
      }
    }
    return removed;
  }

  async getSettings(): Promise<AppSettings | null> {
    if (!(await this.api.exists("settings.json", this.opts()))) return null;
    try {
      return migrateSettings(JSON.parse(await this.api.readTextFile("settings.json", this.opts())));
    } catch (err) {
      log.warn("settings unreadable, using defaults", err);
      return null;
    }
  }

  async readMeta<T>(key: string): Promise<T | null> {
    if (!/^[a-z0-9_-]{1,64}$/.test(key)) throw new Error("Invalid meta key");
    const path = `metadata/${key}.json`;
    if (!(await this.api.exists(path, this.opts()))) return null;
    try {
      return JSON.parse(await this.api.readTextFile(path, this.opts())) as T;
    } catch (err) {
      log.warn("metadata unreadable", key, err);
      return null;
    }
  }

  async writeMeta(key: string, value: unknown): Promise<void> {
    if (!/^[a-z0-9_-]{1,64}$/.test(key)) throw new Error("Invalid meta key");
    await this.writeJsonAtomic(`metadata/${key}.json`, value);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.writeJsonAtomic("settings.json", settings);
  }

  async listRecipes(): Promise<Recipe[]> {
    const out: Recipe[] = [];
    for (const entry of await this.api.readDir("recipes", this.opts())) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(await this.api.readTextFile(`recipes/${entry.name}`, this.opts())) as Recipe);
      } catch (err) {
        log.warn("unreadable recipe", entry.name, err);
      }
    }
    return out;
  }

  async saveRecipe(recipe: Recipe): Promise<void> {
    await this.writeJsonAtomic(`recipes/${assertSafeId(recipe.id)}.json`, recipe);
  }

  async deleteRecipe(recipeId: string): Promise<void> {
    const path = `recipes/${assertSafeId(recipeId)}.json`;
    if (await this.api.exists(path, this.opts())) await this.api.remove(path, this.opts());
  }

  async getUsage(): Promise<StorageUsage> {
    let imageBytes = 0;
    let listingCount = 0;
    for (const listing of await this.api.readDir("listings", this.opts())) {
      if (!listing.isDirectory) continue;
      listingCount++;
      for (const bucket of Object.values(BUCKET_DIR)) {
        const dir = `listings/${listing.name}/${bucket}`;
        if (!(await this.api.exists(dir, this.opts()))) continue;
        for (const file of await this.api.readDir(dir, this.opts())) {
          if (!file.isFile) continue;
          const info = await this.api.stat(`${dir}/${file.name}`, this.opts()).catch(() => null);
          imageBytes += info?.size ?? 0;
        }
      }
    }
    return { listingCount, imageBytes, location: this.locationLabel };
  }

  async clearAll(): Promise<void> {
    for (const entry of await this.api.readDir("listings", this.opts())) {
      await this.api.remove(`listings/${entry.name}`, { ...this.opts(), recursive: true });
    }
    for (const entry of await this.api.readDir("recipes", this.opts())) {
      await this.api.remove(`recipes/${entry.name}`, this.opts());
    }
    if (await this.api.exists("settings.json", this.opts())) await this.api.remove("settings.json", this.opts());
    if (await this.api.exists("metadata", this.opts())) {
      for (const entry of await this.api.readDir("metadata", this.opts())) {
        await this.api.remove(`metadata/${entry.name}`, this.opts());
      }
    }
  }
}
