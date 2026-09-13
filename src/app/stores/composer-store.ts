import { create } from "zustand";
import type { AppSettings, AspectRatio, ImageSize } from "@/domain/models";

interface ComposerState {
  listingId: string | null;
  prompt: string;
  /** null = the listing's original image. */
  sourceImageId: string | null;
  variationCount: number;
  aspectRatio: AspectRatio;
  imageSize: ImageSize | undefined;
  providerId: string;
  modelId: string | null;
  recipeId: string | null;
  recipeValues: Record<string, string>;
  /** Provider-specific options keyed by provider id (e.g. cloudflare.strength). */
  providerOptions: Record<string, Record<string, string | number | boolean>>;
  setProviderOption(providerId: string, key: string, value: string | number | boolean): void;
  resetProviderOptions(providerId: string): void;
  /** Job whose prompt is being edited; kept for "Edit prompt" affordances. */
  editingGenerationId: string | null;
  setPrompt(prompt: string): void;
  setSource(assetId: string | null): void;
  setVariationCount(count: number): void;
  setAspectRatio(ratio: AspectRatio): void;
  setImageSize(size: ImageSize | undefined): void;
  setProvider(providerId: string): void;
  setModel(modelId: string | null): void;
  setRecipe(recipeId: string | null, values?: Record<string, string>): void;
  setRecipeValue(name: string, value: string): void;
  /** Called when a listing opens; resets per-listing state but keeps generation preferences. */
  bindListing(listingId: string | null): void;
  /** Seeds the format and provider from the saved settings — once, at startup (bootstrap). */
  applyDefaults(defaults: Pick<AppSettings, "defaultAspectRatio" | "defaultImageSize" | "activeProviderId">, registeredProviders: ReadonlySet<string>): void;
  loadFromGeneration(input: {
    prompt: string;
    sourceImageId: string | null;
    aspectRatio: AspectRatio;
    imageSize?: ImageSize;
    variationCount: number;
    providerId: string;
    modelId: string;
    generationId: string | null;
    providerOptions?: Record<string, string | number | boolean>;
  }): void;
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  listingId: null,
  prompt: "",
  sourceImageId: null,
  variationCount: 4,
  aspectRatio: "original",
  imageSize: undefined,
  providerId: "gemini",
  modelId: null,
  recipeId: null,
  recipeValues: {},
  providerOptions: {},
  editingGenerationId: null,
  setProviderOption: (providerId, key, value) =>
    set({ providerOptions: { ...get().providerOptions, [providerId]: { ...(get().providerOptions[providerId] ?? {}), [key]: value } } }),
  resetProviderOptions: (providerId) => {
    const next = { ...get().providerOptions };
    delete next[providerId];
    set({ providerOptions: next });
  },
  setPrompt: (prompt) => set({ prompt }),
  setSource: (sourceImageId) => set({ sourceImageId }),
  setVariationCount: (variationCount) => set({ variationCount: Math.max(1, Math.min(8, variationCount)) }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  setImageSize: (imageSize) => set({ imageSize }),
  setProvider: (providerId) => set({ providerId, modelId: null }),
  applyDefaults: (defaults, registeredProviders) => {
    const provider = registeredProviders.has(defaults.activeProviderId) ? defaults.activeProviderId : get().providerId;
    set({
      aspectRatio: defaults.defaultAspectRatio,
      imageSize: defaults.defaultImageSize,
      ...(provider !== get().providerId ? { providerId: provider, modelId: null } : {}),
    });
  },
  setModel: (modelId) => set({ modelId }),
  setRecipe: (recipeId, values = {}) => set({ recipeId, recipeValues: values }),
  setRecipeValue: (name, value) => set({ recipeValues: { ...get().recipeValues, [name]: value } }),
  bindListing: (listingId) => {
    if (listingId === get().listingId) return;
    set({ listingId, prompt: "", sourceImageId: null, recipeId: null, recipeValues: {}, editingGenerationId: null });
  },
  loadFromGeneration: (input) =>
    set({
      prompt: input.prompt,
      sourceImageId: input.sourceImageId,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      variationCount: input.variationCount,
      providerId: input.providerId,
      modelId: input.modelId,
      recipeId: null,
      recipeValues: {},
      ...(input.providerOptions ? { providerOptions: { ...get().providerOptions, [input.providerId]: input.providerOptions } } : {}),
      editingGenerationId: input.generationId,
    }),
}));
