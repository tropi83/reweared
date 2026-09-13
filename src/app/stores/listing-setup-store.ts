import { create } from "zustand";
import { AppError, toGenerationError, type GenerationError, type ListingCopy, type CategorySelection, type ListingDocument } from "@/domain/models";
import { buildShots, catalogRecipeId } from "@/domain/services/catalog";
import { normalizeMannequin } from "@/domain/services/mannequin";
import { prepareForProvider } from "@/infrastructure/image/image-processing";
import { MOCK_PROVIDER_ID } from "@/infrastructure/providers/mock/MockImageProvider";
import { nowIso } from "@/lib/ids";
import { createLogger } from "@/lib/logger";
import { listingReadiness } from "../listing-readiness";
import { authStatusSnapshot } from "../query/auth-status";
import { modelsSnapshot } from "../query/models";
import { getServices } from "../services";
import { useComposerStore } from "./composer-store";
import { useGenerationStore } from "./generation-store";
import { useListingsStore } from "./listings-store";
import { useSettingsStore } from "./settings-store";

const log = createLogger("listing");

/** Vision models cap input resolution anyway; 1024 px keeps the request small and fast. */
const COPY_IMAGE_MAX_DIMENSION = 1024;
export const BRAND_MAX_LENGTH = 60;

export type ListingPartOutcome = "done" | "skipped-provider" | { error: GenerationError };
export interface ListingRunReport {
  photos: ListingPartOutcome;
  text: ListingPartOutcome;
}
export interface GenerateListingOptions {
  /** Per-shot prompt overrides from "Edit prompts" (shot id → prompt). */
  promptOverrides?: Record<string, string>;
  /** A custom recipe (one prompt × 4) instead of the listing pack. */
  customRecipe?: { id: string; prompt: string };
}

interface ListingState {
  copyBusy: boolean;
  copyError: GenerationError | null;
  /** A "Create the listing" run is being planned/started. */
  creating: boolean;
  /** Outcome of the last run, per part (UI summary). */
  lastRun: ListingRunReport | null;
  /** Listing the last run belongs to (the report is not shown on another listing). */
  lastRunListingId: string | null;
  setCategory(selection: CategorySelection | undefined): void;
  /** Stores the brand as typed (max 60 chars); blank removes it. */
  setBrand(raw: string): void;
  setUseMannequin(on: boolean): void;
  /** Generates title/description from the original photo with the copy provider/model chosen in settings. */
  generateCopy(): Promise<ListingCopy | null>;
  /** The main button: photos and text in parallel, each part skipped when its provider is not usable. */
  generateListing(options?: GenerateListingOptions): Promise<ListingRunReport | null>;
  cancelListingRun(): void;
  updateCopy(patch: Partial<Pick<ListingCopy, "title" | "description" | "keywords" | "brand" | "color" | "condition">>): void;
  cancelCopy(): void;
}

let copyController: AbortController | null = null;

/** The composer's image provider can run: authenticated (or Mock) with an available model selected. */
export function photoPartReady(): boolean {
  const { providerId, modelId } = useComposerStore.getState();
  const authOk = providerId === MOCK_PROVIDER_ID || authStatusSnapshot(providerId)?.state === "authenticated";
  const model = modelsSnapshot(providerId).find((m) => m.id === modelId);
  return authOk && !!model?.available;
}

/** The copy provider chosen in settings exists and is authenticated. */
export function textPartReady(): boolean {
  const { copyProviderId } = useSettingsStore.getState().settings;
  return getServices().copyProviders.has(copyProviderId) && authStatusSnapshot(copyProviderId)?.state === "authenticated";
}

async function startPhotos(
  doc: ListingDocument,
  selection: CategorySelection,
  sourceImageId: string,
  options: GenerateListingOptions,
): Promise<ListingPartOutcome> {
  const composer = useComposerStore.getState();
  const settings = useSettingsStore.getState().settings;
  const modelId = composer.modelId;
  if (!modelId) return "skipped-provider";
  const mannequin = doc.listing.useMannequin ? normalizeMannequin(settings.mannequin) : undefined;
  const providerOptions = composer.providerOptions[composer.providerId] ?? {};
  const common = {
    sourceImageId,
    providerId: composer.providerId,
    modelId,
    aspectRatio: composer.aspectRatio,
    ...(composer.imageSize ? { imageSize: composer.imageSize } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  };
  try {
    if (options.customRecipe) {
      await useGenerationStore.getState().start({ ...common, prompt: options.customRecipe.prompt, variationCount: 4, recipeId: options.customRecipe.id });
    } else {
      const shots = buildShots(selection, mannequin ? { mannequin } : {}).map((s) => ({
        ...s,
        prompt: options.promptOverrides?.[s.id]?.trim() || s.prompt,
      }));
      await useGenerationStore
        .getState()
        .start({ ...common, prompt: "", variationCount: shots.length, recipeId: catalogRecipeId(selection), category: selection, shots });
    }
    if (settings.lastModelByProvider[composer.providerId] !== modelId) {
      void useSettingsStore.getState().update({ lastModelByProvider: { ...settings.lastModelByProvider, [composer.providerId]: modelId } });
    }
    return "done";
  } catch (err) {
    const error = toGenerationError(err);
    log.warn("listing photos failed to start", error.code);
    return { error };
  }
}

export const useListingSetupStore = create<ListingState>((set, get) => ({
  copyBusy: false,
  copyError: null,
  creating: false,
  lastRun: null,
  lastRunListingId: null,

  setCategory(selection) {
    useListingsStore.getState().commit((doc) => {
      if (selection) doc.listing.category = selection;
      else delete doc.listing.category;
    });
  },

  setBrand(raw) {
    const value = raw.slice(0, BRAND_MAX_LENGTH);
    useListingsStore.getState().commit((doc) => {
      if (value.trim()) doc.listing.brand = value;
      else delete doc.listing.brand;
    });
  },

  setUseMannequin(on) {
    useListingsStore.getState().commit((doc) => {
      if (on) doc.listing.useMannequin = true;
      else delete doc.listing.useMannequin;
    });
  },

  async generateCopy() {
    const listings = useListingsStore.getState();
    const doc = listings.current;
    const originalId = doc?.listing.originalImageId;
    if (!doc || !originalId) return null;
    const asset = doc.images[originalId];
    const { copyProviderId: providerId, copyModelByProvider } = useSettingsStore.getState().settings;
    const provider = getServices().copyProviders.get(providerId);
    if (!asset || !provider) {
      set({ copyError: { code: "PROVIDER_UNAVAILABLE", message: "No vision model for this provider.", retryable: false } });
      return null;
    }
    copyController?.abort();
    copyController = new AbortController();
    const { signal } = copyController;
    set({ copyBusy: true, copyError: null });
    try {
      const blob = await getServices().storage.readImage(doc.listing.id, asset.kind, asset.id);
      if (!blob) throw new AppError("INVALID_IMAGE", "The original image file is missing.");
      const prepared = await prepareForProvider(blob, asset.mimeType, { maxDimension: COPY_IMAGE_MAX_DIMENSION, format: "image/jpeg" });
      const language = useSettingsStore.getState().settings.locale;
      // The seller's brand wins over whatever the model reads (or invents) on the photo.
      const brand = doc.listing.brand?.trim();
      const result = await provider.describeListing(
        {
          image: { blob: prepared.blob, mimeType: prepared.mimeType },
          ...(doc.listing.category ? { category: doc.listing.category } : {}),
          language,
          ...(brand ? { brand } : {}),
        },
        { signal, ...(copyModelByProvider[providerId] ? { model: copyModelByProvider[providerId] } : {}) },
      );
      if (signal.aborted) return null;
      const copy: ListingCopy = {
        ...result.copy,
        ...(brand ? { brand } : {}),
        language,
        generatedAt: nowIso(),
        provider: providerId,
        model: String(result.providerMeta?.model ?? ""),
      };
      useListingsStore.getState().commit(
        (draft) => {
          draft.listing.copy = copy;
        },
        { immediate: true },
      );
      getServices().usage.track({ provider: providerId, model: copy.model || "vision", outcome: "ok" });
      return copy;
    } catch (err) {
      if (signal.aborted) return null;
      const error = toGenerationError(err);
      log.warn("copy generation failed", error.code);
      set({ copyError: error });
      return null;
    } finally {
      if (copyController?.signal === signal) copyController = null;
      set({ copyBusy: false });
    }
  },

  async generateListing(options = {}) {
    const doc = useListingsStore.getState().current;
    const selection = doc?.listing.category;
    const sourceImageId = useComposerStore.getState().sourceImageId ?? doc?.listing.originalImageId;
    const readiness = listingReadiness({
      hasImage: !!doc?.listing.originalImageId && !!sourceImageId,
      hasSelection: !!selection,
      photosReady: photoPartReady(),
      textReady: textPartReady(),
    });
    if (!doc || !selection || !sourceImageId || !readiness.canCreate || get().creating) return null;
    set({ creating: true, lastRun: null, lastRunListingId: doc.listing.id });
    const photos = readiness.skipped.includes("photos")
      ? Promise.resolve<ListingPartOutcome>("skipped-provider")
      : startPhotos(doc, selection, sourceImageId, options);
    const text = readiness.skipped.includes("text")
      ? Promise.resolve<ListingPartOutcome>("skipped-provider")
      : get()
          .generateCopy()
          .then<ListingPartOutcome>((result) =>
            result ? "done" : { error: get().copyError ?? { code: "CANCELLED", message: "Cancelled.", retryable: false } },
          );
    // Independent parts: one failing never cancels or rolls back the other.
    const [p, t] = await Promise.allSettled([photos, text]);
    const settled = (r: PromiseSettledResult<ListingPartOutcome>): ListingPartOutcome =>
      r.status === "fulfilled" ? r.value : { error: toGenerationError(r.reason) };
    const report: ListingRunReport = { photos: settled(p), text: settled(t) };
    set({ creating: false, lastRun: report });
    return report;
  },

  cancelListingRun() {
    useGenerationStore.getState().cancelAll();
    get().cancelCopy();
  },

  updateCopy(patch) {
    useListingsStore.getState().commit((doc) => {
      if (!doc.listing.copy) return;
      doc.listing.copy = { ...doc.listing.copy, ...patch };
    });
  },

  cancelCopy() {
    copyController?.abort();
    copyController = null;
    set({ copyBusy: false });
  },
}));
