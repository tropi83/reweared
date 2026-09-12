import { create } from "zustand";
import { AppError, deriveGenerationStatus, type AspectRatio, type Generation, type GenerationJob, type ImageSize, type ModelInfo } from "@/domain/models";
import type { CategorySelection, ShotSpec } from "@/domain/models";
import {
  buildRequestForModel,
  inputPreparationFor,
  seedForAttempt,
  type ImageGenerationRequest,
  type ImageGenerationResult,
} from "@/domain/services/image-provider";
import { prepareForProvider } from "@/infrastructure/image/image-processing";
import { createId, nowIso } from "@/lib/ids";
import { createLogger } from "@/lib/logger";
import { getServices } from "../services";
import { useListingsStore } from "./listings-store";
import { useSettingsStore } from "./settings-store";

const log = createLogger("generation");

export interface StartGenerationParams {
  sourceImageId: string;
  prompt: string;
  providerId: string;
  modelId: string;
  aspectRatio: AspectRatio;
  imageSize?: ImageSize;
  variationCount: number;
  recipeId?: string;
  providerOptions?: Record<string, string | number | boolean>;
  /**
   * Listing pack: one job per shot, each with its own prompt (variationCount is ignored).
   * `prompt` then only serves as the generation's summary.
   */
  shots?: ShotSpec[];
  category?: CategorySelection;
}

interface GenerationState {
  /** Models per provider, refreshed when the provider or credentials change. */
  modelsByProvider: Record<string, ModelInfo[]>;
  modelsLoading: boolean;
  loadModels(providerId: string, force?: boolean): Promise<ModelInfo[]>;
  start(params: StartGenerationParams): Promise<Generation>;
  retryJob(jobId: string): void;
  retryFailed(generationId: string): void;
  cancelGeneration(generationId: string): void;
  cancelAll(): void;
}

/** Cache of prepared source images so N variations share one downscale/encode pass. */
const preparedCache = new Map<string, Promise<{ blob: Blob; mimeType: "image/png" | "image/jpeg"; width: number; height: number }>>();

/** 31-bit seed so deterministic providers (diffusion) produce a different image per job. */
function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) % 2_147_483_647;
}

function preparedKey(listingId: string, assetId: string, spec: { maxDimension: number; multipleOf?: number; cropToAspectRatio?: string; format: string }) {
  return `${listingId}/${assetId}/${spec.maxDimension}/${spec.multipleOf ?? 0}/${spec.cropToAspectRatio ?? "-"}/${spec.format}`;
}

export async function buildRequestForJob(job: GenerationJob, _signal: AbortSignal): Promise<ImageGenerationRequest> {
  const { storage } = getServices();
  const doc = useListingsStore.getState().current;
  const asset = doc?.images[job.sourceImageId];
  if (!doc || doc.listing.id !== job.listingId || !asset) {
    throw new AppError("INVALID_IMAGE", "The source image is no longer available.", { retryable: false });
  }
  const models = useGenerationStore.getState().modelsByProvider[job.provider] ?? [];
  const model = models.find((m) => m.id === job.model);
  if (!model) throw new AppError("MODEL_UNAVAILABLE", "The selected model is not available.", { retryable: false });

  const spec = inputPreparationFor(
    model,
    { aspectRatio: job.aspectRatio, ...(job.imageSize ? { imageSize: job.imageSize } : {}) },
    useSettingsStore.getState().settings.prepareMaxDimension,
  );
  const key = preparedKey(job.listingId, job.sourceImageId, spec);
  let prepared = preparedCache.get(key);
  if (!prepared) {
    prepared = (async () => {
      const blob = await storage.readImage(job.listingId, asset.kind, asset.id);
      if (!blob) throw new AppError("INVALID_IMAGE", "The source image file is missing.", { retryable: false });
      const out = await prepareForProvider(blob, asset.mimeType, {
        maxDimension: spec.maxDimension,
        ...(spec.multipleOf ? { multipleOf: spec.multipleOf } : {}),
        ...(spec.cropToAspectRatio ? { cropToAspectRatio: spec.cropToAspectRatio } : {}),
        ...(model.capabilities.inputImage ? { format: spec.format } : {}),
      });
      return { blob: out.blob, mimeType: out.mimeType, width: out.width, height: out.height };
    })();
    preparedCache.set(key, prepared);
    prepared.catch(() => preparedCache.delete(key));
    // Prepared payloads are transient: drop them shortly after the burst of jobs.
    setTimeout(() => preparedCache.delete(key), 5 * 60_000);
  }
  const source = await prepared;
  return buildRequestForModel(model, {
    prompt: job.prompt,
    sourceImage: { blob: source.blob, mimeType: source.mimeType, width: source.width, height: source.height },
    aspectRatio: job.aspectRatio,
    ...(job.imageSize ? { imageSize: job.imageSize } : {}),
    // Automatic retries get a derived seed (see seedForAttempt): same seed = same output = same rejection.
    ...(job.seed !== undefined ? { seed: seedForAttempt(job.seed, job.attempt) } : {}),
    ...(job.providerOptions ? { options: job.providerOptions } : {}),
  });
}

export async function persistJobResult(job: GenerationJob, result: ImageGenerationResult): Promise<string> {
  return useListingsStore.getState().addResultImage(job, result.image, result.mimeType);
}

export function applyJobUpdate(job: GenerationJob): void {
  const listings = useListingsStore.getState();
  const doc = listings.current;
  if (!doc || doc.listing.id !== job.listingId) return;
  const terminal = job.status === "completed" || job.status === "failed" || job.status === "cancelled";
  listings.commit(
    (draft) => {
      draft.jobs[job.id] = job;
      const gen = draft.generations[job.generationId];
      if (!gen) return;
      const jobs = gen.jobIds.map((id) => draft.jobs[id]).filter((j): j is GenerationJob => !!j);
      gen.status = deriveGenerationStatus(jobs);
      if (gen.status !== "active") gen.completedAt = nowIso();
      // The newest result becomes the listing cover in the sidebar.
      if (job.status === "completed" && job.resultImageId) draft.listing.coverImageId = job.resultImageId;
    },
    { immediate: terminal },
  );
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  modelsByProvider: {},
  modelsLoading: false,

  async loadModels(providerId, force = false) {
    const cached = get().modelsByProvider[providerId];
    if (cached && !force) return cached;
    const provider = getServices().providers.get(providerId);
    if (!provider) return [];
    set({ modelsLoading: true });
    try {
      const models = await provider.getModels();
      set({ modelsByProvider: { ...get().modelsByProvider, [providerId]: models } });
      return models;
    } catch (err) {
      log.warn("loadModels failed", err);
      return cached ?? [];
    } finally {
      set({ modelsLoading: false });
    }
  },

  async start(params) {
    const listings = useListingsStore.getState();
    const doc = listings.current;
    if (!doc) throw new AppError("INVALID_REQUEST", "No open listing.");
    const source = doc.images[params.sourceImageId];
    if (!source) throw new AppError("INVALID_IMAGE", "Source image not found.");
    const prompt = params.prompt.trim();
    const shots = params.shots?.filter((s) => s.prompt.trim().length > 0) ?? [];
    if (!prompt && shots.length === 0) throw new AppError("INVALID_REQUEST", "Prompt is empty.");
    const models = await get().loadModels(params.providerId);
    const model = models.find((m) => m.id === params.modelId);
    if (!model) throw new AppError("MODEL_UNAVAILABLE", "Select an available model.");

    const count = shots.length > 0 ? Math.min(8, shots.length) : Math.max(1, Math.min(8, Math.round(params.variationCount)));
    const now = nowIso();
    const generationId = createId("gen");
    const jobs: GenerationJob[] = Array.from({ length: count }, (_, i) => ({
      id: createId("job"),
      listingId: doc.listing.id,
      generationId,
      sourceImageId: source.id,
      index: i + 1,
      prompt: shots[i]?.prompt.trim() ?? prompt,
      ...(shots[i] ? { shotId: shots[i]!.id, shotLabel: shots[i]!.label } : {}),
      provider: params.providerId,
      model: params.modelId,
      aspectRatio: params.aspectRatio,
      ...(params.imageSize && model.capabilities.supportedImageSizes.includes(params.imageSize) ? { imageSize: params.imageSize } : {}),
      ...(params.providerOptions && Object.keys(params.providerOptions).length > 0 ? { providerOptions: params.providerOptions } : {}),
      seed: randomSeed(),
      status: "queued",
      attempt: 0,
      createdAt: now,
    }));
    const generation: Generation = {
      id: generationId,
      listingId: doc.listing.id,
      sourceImageId: source.id,
      ...(source.generationId ? { parentGenerationId: source.generationId } : {}),
      prompt: prompt || (shots[0]?.prompt ?? ""),
      ...(params.recipeId ? { recipeId: params.recipeId } : {}),
      ...(params.category ? { category: params.category } : {}),
      settings: {
        providerId: params.providerId,
        modelId: params.modelId,
        aspectRatio: params.aspectRatio,
        ...(params.imageSize ? { imageSize: params.imageSize } : {}),
        ...(params.providerOptions && Object.keys(params.providerOptions).length > 0 ? { providerOptions: params.providerOptions } : {}),
        variationCount: count,
      },
      status: "active",
      jobIds: jobs.map((j) => j.id),
      createdAt: now,
    };
    listings.commit(
      (draft) => {
        draft.generations[generation.id] = generation;
        for (const job of jobs) draft.jobs[job.id] = job;
      },
      { immediate: true },
    );
    getServices().queue.enqueue(jobs);
    return generation;
  },

  retryJob(jobId) {
    const doc = useListingsStore.getState().current;
    const job = doc?.jobs[jobId];
    if (!job) return;
    const { queue } = getServices();
    // A fresh seed: a diffusion model returns the same image for the same seed, so retrying with the old one
    // would reproduce the same output — and the same safety-filter rejection.
    const patch = job.seed !== undefined ? { seed: randomSeed() } : {};
    if (queue.getJob(jobId)) queue.retry(jobId, patch);
    else queue.enqueue([{ ...job, ...patch, attempt: 0, resultImageId: undefined, completedAt: undefined }]);
  },

  retryFailed(generationId) {
    const doc = useListingsStore.getState().current;
    const gen = doc?.generations[generationId];
    if (!doc || !gen) return;
    for (const id of gen.jobIds) {
      const job = doc.jobs[id];
      if (job && (job.status === "failed" || job.status === "cancelled")) get().retryJob(id);
    }
  },

  cancelGeneration(generationId) {
    getServices().queue.cancelGeneration(generationId);
  },

  cancelAll() {
    getServices().queue.cancelAll();
  },
}));
