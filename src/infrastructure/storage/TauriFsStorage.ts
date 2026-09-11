import { summarize, type AppSettings, type ProjectDocument, type ProjectSummary, type Recipe } from "@/domain/models";
import { assertSafeId } from "@/lib/ids";
import { createLogger } from "@/lib/logger";
import { migrateProjectDocument, migrateSettings } from "./migrations";
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
 *   projects/<projectId>/project.json
 *   projects/<projectId>/original/<assetId>.<ext>
 *   projects/<projectId>/generations/<assetId>.<ext>
 *   projects/<projectId>/thumbnails/<assetId>.<ext>
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
    await fs.mkdir("projects", { baseDir: this.base, recursive: true });
    await fs.mkdir("recipes", { baseDir: this.base, recursive: true });
  }

  private get api(): FsModule {
    if (!this.fs) throw new Error("Storage not initialized");
    return this.fs;
  }

  private opts() {
    return { baseDir: this.base };
  }

  private projectDir(projectId: string): string {
    return `projects/${assertSafeId(projectId)}`;
  }

  private async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    const tmp = `${path}.tmp`;
    await this.api.writeTextFile(tmp, JSON.stringify(value, null, 2), this.opts());
    if (await this.api.exists(path, this.opts())) await this.api.remove(path, this.opts());
    await this.api.rename(tmp, path, { oldPathBaseDir: this.base, newPathBaseDir: this.base });
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const entries = await this.api.readDir("projects", this.opts());
    const summaries: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const doc = await this.getProject(entry.name).catch((err) => {
        log.warn("unreadable project", entry.name, err);
        return null;
      });
      if (doc) summaries.push(summarize(doc));
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(projectId: string): Promise<ProjectDocument | null> {
    const file = `${this.projectDir(projectId)}/project.json`;
    if (!(await this.api.exists(file, this.opts()))) return null;
    const text = await this.api.readTextFile(file, this.opts());
    return migrateProjectDocument(JSON.parse(text));
  }

  async saveProject(doc: ProjectDocument): Promise<void> {
    const dir = this.projectDir(doc.project.id);
    await this.api.mkdir(dir, { ...this.opts(), recursive: true });
    await this.writeJsonAtomic(`${dir}/project.json`, doc);
  }

  async deleteProject(projectId: string): Promise<void> {
    const dir = this.projectDir(projectId);
    if (await this.api.exists(dir, this.opts())) await this.api.remove(dir, { ...this.opts(), recursive: true });
  }

  private async findImagePath(projectId: string, bucket: ImageBucket, assetId: string): Promise<string | null> {
    const dir = `${this.projectDir(projectId)}/${BUCKET_DIR[bucket]}`;
    for (const ext of EXTENSIONS) {
      const candidate = `${dir}/${assertSafeId(assetId)}.${ext}`;
      if (await this.api.exists(candidate, this.opts())) return candidate;
    }
    return null;
  }

  async writeImage(projectId: string, bucket: ImageBucket, assetId: string, blob: Blob): Promise<void> {
    const dir = `${this.projectDir(projectId)}/${BUCKET_DIR[bucket]}`;
    await this.api.mkdir(dir, { ...this.opts(), recursive: true });
    const existing = await this.findImagePath(projectId, bucket, assetId);
    if (existing) await this.api.remove(existing, this.opts());
    const target = `${dir}/${assertSafeId(assetId)}.${extFor(blob.type)}`;
    await this.api.writeFile(target, new Uint8Array(await blob.arrayBuffer()), this.opts());
  }

  async readImage(projectId: string, bucket: ImageBucket, assetId: string): Promise<Blob | null> {
    const path = await this.findImagePath(projectId, bucket, assetId);
    if (!path) return null;
    const bytes = await this.api.readFile(path, this.opts());
    const ext = path.slice(path.lastIndexOf(".") + 1);
    const type = ext === "jpg" ? "image/jpeg" : ext === "png" ? "image/png" : "image/webp";
    return new Blob([bytes], { type });
  }

  async deleteImage(projectId: string, bucket: ImageBucket, assetId: string): Promise<void> {
    const path = await this.findImagePath(projectId, bucket, assetId);
    if (path) await this.api.remove(path, this.opts());
  }

  async cleanupOrphans(projectId: string): Promise<number> {
    const doc = await this.getProject(projectId);
    let removed = 0;
    for (const bucket of Object.values(BUCKET_DIR)) {
      const dir = `${this.projectDir(projectId)}/${bucket}`;
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
    let projectCount = 0;
    for (const project of await this.api.readDir("projects", this.opts())) {
      if (!project.isDirectory) continue;
      projectCount++;
      for (const bucket of Object.values(BUCKET_DIR)) {
        const dir = `projects/${project.name}/${bucket}`;
        if (!(await this.api.exists(dir, this.opts()))) continue;
        for (const file of await this.api.readDir(dir, this.opts())) {
          if (!file.isFile) continue;
          const info = await this.api.stat(`${dir}/${file.name}`, this.opts()).catch(() => null);
          imageBytes += info?.size ?? 0;
        }
      }
    }
    return { projectCount, imageBytes, location: this.locationLabel };
  }

  async clearAll(): Promise<void> {
    for (const entry of await this.api.readDir("projects", this.opts())) {
      await this.api.remove(`projects/${entry.name}`, { ...this.opts(), recursive: true });
    }
    for (const entry of await this.api.readDir("recipes", this.opts())) {
      await this.api.remove(`recipes/${entry.name}`, this.opts());
    }
    if (await this.api.exists("settings.json", this.opts())) await this.api.remove("settings.json", this.opts());
  }
}
