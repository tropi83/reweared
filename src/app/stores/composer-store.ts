import { create } from "zustand";
import type { AspectRatio, ImageSize } from "@/domain/models";

interface ComposerState {
  projectId: string | null;
  prompt: string;
  /** null = the project's original image. */
  sourceImageId: string | null;
  variationCount: number;
  aspectRatio: AspectRatio;
  imageSize: ImageSize | undefined;
  providerId: string;
  modelId: string | null;
  recipeId: string | null;
  recipeValues: Record<string, string>;
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
  /** Called when a project opens; resets per-project state but keeps generation preferences. */
  bindProject(projectId: string | null): void;
  loadFromGeneration(input: {
    prompt: string;
    sourceImageId: string | null;
    aspectRatio: AspectRatio;
    imageSize?: ImageSize;
    variationCount: number;
    providerId: string;
    modelId: string;
    generationId: string | null;
  }): void;
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  projectId: null,
  prompt: "",
  sourceImageId: null,
  variationCount: 4,
  aspectRatio: "original",
  imageSize: undefined,
  providerId: "gemini",
  modelId: null,
  recipeId: null,
  recipeValues: {},
  editingGenerationId: null,
  setPrompt: (prompt) => set({ prompt }),
  setSource: (sourceImageId) => set({ sourceImageId }),
  setVariationCount: (variationCount) => set({ variationCount: Math.max(1, Math.min(8, variationCount)) }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  setImageSize: (imageSize) => set({ imageSize }),
  setProvider: (providerId) => set({ providerId, modelId: null }),
  setModel: (modelId) => set({ modelId }),
  setRecipe: (recipeId, values = {}) => set({ recipeId, recipeValues: values }),
  setRecipeValue: (name, value) => set({ recipeValues: { ...get().recipeValues, [name]: value } }),
  bindProject: (projectId) => {
    if (projectId === get().projectId) return;
    set({ projectId, prompt: "", sourceImageId: null, recipeId: null, recipeValues: {}, editingGenerationId: null });
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
      editingGenerationId: input.generationId,
    }),
}));
