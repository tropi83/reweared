import { create } from "zustand";
import {
  AppError,
  CURRENT_SCHEMA_VERSION,
  summarize,
  type GenerationJob,
  type ImageAsset,
  type ImageMimeType,
  type ProjectDocument,
  type ProjectSummary,
} from "@/domain/models";
import { createThumbnail, decodeImage, validateImageFile } from "@/infrastructure/image/image-processing";
import { createId, nowIso } from "@/lib/ids";
import { createLogger } from "@/lib/logger";
import { evictImageUrls, primeImageUrl } from "../image-urls";
import { getServices } from "../services";

const log = createLogger("projects");

interface ProjectsState {
  summaries: ProjectSummary[];
  current: ProjectDocument | null;
  loadingList: boolean;
  loadingProject: boolean;
  loadSummaries(): Promise<void>;
  open(projectId: string): Promise<ProjectDocument | null>;
  close(): void;
  createFromFile(file: Blob, fileName?: string): Promise<ProjectDocument>;
  rename(projectId: string, name: string): Promise<void>;
  remove(projectId: string): Promise<void>;
  duplicate(projectId: string): Promise<ProjectDocument | null>;
  /** Applies a synchronous mutation to the open project and schedules a save. */
  commit(mutator: (doc: ProjectDocument) => void, options?: { immediate?: boolean }): void;
  flush(): Promise<void>;
  toggleFavorite(assetId: string): void;
  deleteImages(assetIds: string[]): Promise<void>;
  deleteGeneration(generationId: string): Promise<void>;
  /** Stores a generated result (full image + thumbnail) and links it to its job. */
  addResultImage(job: GenerationJob, blob: Blob, mimeType: ImageMimeType): Promise<string>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<void> | null = null;

function scheduleSave(get: () => ProjectsState, immediate: boolean) {
  if (saveTimer) clearTimeout(saveTimer);
  const run = async () => {
    saveTimer = null;
    const doc = get().current;
    if (!doc) return;
    try {
      await getServices().storage.saveProject(doc);
    } catch (err) {
      log.error("save failed", err);
    }
    // Keep the sidebar in sync without reloading everything.
    const summary = summarize(doc);
    const summaries = get().summaries.some((s) => s.id === summary.id)
      ? get().summaries.map((s) => (s.id === summary.id ? summary : s))
      : [summary, ...get().summaries];
    useProjectsStore.setState({ summaries: summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
  };
  if (immediate) {
    savePromise = run();
  } else {
    saveTimer = setTimeout(() => {
      savePromise = run();
    }, 250);
  }
}

async function storeImageWithThumbnail(projectId: string, kind: ImageAsset["kind"], blob: Blob, mimeType: ImageMimeType, extra: Partial<ImageAsset>) {
  const { storage } = getServices();
  const decoded = await decodeImage(blob);
  let thumbnail: Blob;
  try {
    thumbnail = await createThumbnail(decoded.bitmap);
  } finally {
    decoded.bitmap.close();
  }
  const asset: ImageAsset = {
    id: createId("img"),
    projectId,
    kind,
    mimeType,
    width: decoded.width,
    height: decoded.height,
    byteSize: blob.size,
    createdAt: nowIso(),
    ...extra,
  };
  try {
    await storage.writeImage(projectId, kind, asset.id, blob);
    await storage.writeImage(projectId, "thumbnail", asset.id, thumbnail);
  } catch (err) {
    await storage.deleteImage(projectId, kind, asset.id).catch(() => undefined);
    await storage.deleteImage(projectId, "thumbnail", asset.id).catch(() => undefined);
    throw new AppError("STORAGE_ERROR", "The image could not be saved on this device.", { cause: err });
  }
  primeImageUrl(projectId, kind, asset.id, blob);
  primeImageUrl(projectId, "thumbnail", asset.id, thumbnail);
  return asset;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  summaries: [],
  current: null,
  loadingList: false,
  loadingProject: false,

  async loadSummaries() {
    set({ loadingList: true });
    try {
      set({ summaries: await getServices().storage.listProjects() });
    } finally {
      set({ loadingList: false });
    }
  },

  async open(projectId) {
    if (get().current?.project.id === projectId) return get().current;
    await get().flush();
    set({ loadingProject: true });
    try {
      const doc = await getServices().storage.getProject(projectId);
      if (doc) {
        // Jobs interrupted by a previous app close must never look alive.
        for (const job of Object.values(doc.jobs)) {
          if (job.status === "queued" || job.status === "generating") {
            job.status = "failed";
            job.error = { code: "CANCELLED", message: "Interrupted when the app closed.", retryable: false };
            job.completedAt = nowIso();
          }
        }
      }
      set({ current: doc });
      return doc;
    } finally {
      set({ loadingProject: false });
    }
  },

  close() {
    void get().flush();
    set({ current: null });
  },

  async createFromFile(file, fileName) {
    const validated = await validateImageFile(file);
    const projectId = createId("prj");
    const mime: ImageMimeType = validated.mimeType === "image/jpeg" ? "image/jpeg" : validated.mimeType === "image/png" ? "image/png" : "image/webp";
    // Non-native formats (gif/bmp/avif) are re-encoded losslessly to PNG so every stored original is a web-safe file.
    let blob = validated.blob;
    let storedMime = mime;
    if (validated.mimeType !== "image/png" && validated.mimeType !== "image/jpeg" && validated.mimeType !== "image/webp") {
      const { encodeBitmap } = await import("@/infrastructure/image/image-processing");
      const decoded = await decodeImage(validated.blob);
      try {
        blob = (await encodeBitmap(decoded.bitmap, { type: "image/png" })).blob;
      } finally {
        decoded.bitmap.close();
      }
      storedMime = "image/png";
    }
    const asset = await storeImageWithThumbnail(projectId, "original", blob, storedMime, fileName ? { fileName } : {});
    const now = nowIso();
    const baseName = (fileName ?? "").replace(/\.[^.]+$/, "").trim();
    const doc: ProjectDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: getServices().appVersion,
      project: { id: projectId, name: baseName || "Untitled project", originalImageId: asset.id, coverImageId: asset.id, createdAt: now, updatedAt: now },
      images: { [asset.id]: asset },
      generations: {},
      jobs: {},
      favorites: [],
    };
    await getServices().storage.saveProject(doc);
    await get().flush();
    set({ current: doc, summaries: [summarize(doc), ...get().summaries] });
    return doc;
  },

  async rename(projectId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (get().current?.project.id === projectId) {
      get().commit((doc) => {
        doc.project.name = trimmed;
      });
      return;
    }
    const doc = await getServices().storage.getProject(projectId);
    if (!doc) return;
    doc.project.name = trimmed;
    doc.project.updatedAt = nowIso();
    await getServices().storage.saveProject(doc);
    set({ summaries: get().summaries.map((s) => (s.id === projectId ? summarize(doc) : s)) });
  },

  async remove(projectId) {
    if (get().current?.project.id === projectId) {
      getServices().queue.cancelAll();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      set({ current: null });
    }
    await getServices().storage.deleteProject(projectId);
    evictImageUrls(projectId);
    set({ summaries: get().summaries.filter((s) => s.id !== projectId) });
  },

  async duplicate(projectId) {
    const { storage } = getServices();
    const source = await storage.getProject(projectId);
    if (!source) return null;
    const newId = createId("prj");
    const now = nowIso();
    const doc: ProjectDocument = structuredClone(source);
    doc.project = { ...doc.project, id: newId, name: `${source.project.name} (copy)`, createdAt: now, updatedAt: now };
    for (const image of Object.values(doc.images)) image.projectId = newId;
    for (const gen of Object.values(doc.generations)) gen.projectId = newId;
    for (const job of Object.values(doc.jobs)) job.projectId = newId;
    for (const image of Object.values(source.images)) {
      for (const bucket of [image.kind, "thumbnail"] as const) {
        const blob = await storage.readImage(projectId, bucket, image.id);
        if (blob) await storage.writeImage(newId, bucket, image.id, blob);
      }
    }
    await storage.saveProject(doc);
    set({ summaries: [summarize(doc), ...get().summaries] });
    return doc;
  },

  commit(mutator, options) {
    const current = get().current;
    if (!current) return;
    const next = structuredClone(current);
    mutator(next);
    next.project.updatedAt = nowIso();
    set({ current: next });
    scheduleSave(get, options?.immediate ?? false);
  },

  async flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const doc = get().current;
      if (doc) {
        savePromise = getServices()
          .storage.saveProject(doc)
          .catch((err) => log.error("flush failed", err));
      }
    }
    await savePromise;
  },

  toggleFavorite(assetId) {
    get().commit((doc) => {
      const idx = doc.favorites.indexOf(assetId);
      if (idx >= 0) doc.favorites.splice(idx, 1);
      else doc.favorites.push(assetId);
    });
  },

  async deleteImages(assetIds) {
    const current = get().current;
    if (!current) return;
    const { storage, queue } = getServices();
    const ids = new Set(assetIds.filter((id) => id !== current.project.originalImageId));
    get().commit(
      (doc) => {
        for (const id of ids) {
          const asset = doc.images[id];
          if (!asset) continue;
          delete doc.images[id];
          doc.favorites = doc.favorites.filter((f) => f !== id);
          if (asset.jobId) {
            const job = doc.jobs[asset.jobId];
            if (job) {
              queue.cancel(job.id);
              delete doc.jobs[job.id];
              const gen = doc.generations[job.generationId];
              if (gen) {
                gen.jobIds = gen.jobIds.filter((j) => j !== job.id);
                if (gen.jobIds.length === 0) delete doc.generations[gen.id];
              }
            }
          }
          if (doc.project.coverImageId === id) doc.project.coverImageId = doc.project.originalImageId;
        }
      },
      { immediate: true },
    );
    for (const id of ids) {
      const asset = current.images[id];
      if (!asset) continue;
      await storage.deleteImage(current.project.id, asset.kind, id).catch((err) => log.warn("delete image failed", err));
      await storage.deleteImage(current.project.id, "thumbnail", id).catch(() => undefined);
      evictImageUrls(current.project.id, id);
    }
  },

  async deleteGeneration(generationId) {
    const current = get().current;
    if (!current) return;
    const gen = current.generations[generationId];
    if (!gen) return;
    getServices().queue.cancelGeneration(generationId);
    const imageIds = gen.jobIds.map((j) => current.jobs[j]?.resultImageId).filter((id): id is string => !!id);
    await get().deleteImages(imageIds);
    get().commit(
      (doc) => {
        for (const jobId of gen.jobIds) delete doc.jobs[jobId];
        delete doc.generations[generationId];
      },
      { immediate: true },
    );
  },

  async addResultImage(job, blob, mimeType) {
    const current = get().current;
    if (!current || current.project.id !== job.projectId) {
      throw new AppError("CANCELLED", "The project was closed before the result arrived.", { retryable: false });
    }
    const asset = await storeImageWithThumbnail(job.projectId, "generation", blob, mimeType, { generationId: job.generationId, jobId: job.id });
    get().commit((doc) => {
      doc.images[asset.id] = asset;
    });
    return asset.id;
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    void useProjectsStore.getState().flush();
  });
}
