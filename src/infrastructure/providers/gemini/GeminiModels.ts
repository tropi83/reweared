import type { AspectRatio, ImageSize, ModelInfo } from "@/domain/models";

/**
 * Capability catalogue for Gemini image models.
 *
 * Source of truth: https://ai.google.dev/gemini-api/docs/image-generation (verified 2026-09-11).
 * - Gemini 3 image models output 1K by default and accept 2K / 4K; 512px is 3.1 Flash Image only.
 * - Gemini 3.1 Flash-Lite Image only supports 1K.
 * - Gemini 2.5 Flash Image (legacy) accepts aspect ratios but no image_size parameter.
 * - Supported aspect ratios: 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9.
 * - Pricing (https://ai.google.dev/gemini-api/docs/pricing, 2026-09-11): every image model is
 *   "Free tier: Not available" — a project without a billing account gets `limit: 0`.
 * - gemini-2.5-flash-image is deprecated and shuts down on 2026-10-02.
 *
 * Every model-specific rule lives here; nothing else in the app tests model ids.
 */
export const GEMINI_ASPECT_RATIOS: Exclude<AspectRatio, "original">[] = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

const SIZES_3X: ImageSize[] = ["1K", "2K", "4K"];

export const GEMINI_IMAGE_MODELS: ModelInfo[] = [
  {
    id: "gemini-3.1-flash-image",
    displayName: "Balanced",
    tier: "balanced",
    description: "Gemini 3.1 Flash Image — versatile, up to 4K.",
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 14,
      supportedAspectRatios: GEMINI_ASPECT_RATIOS,
      supportedImageSizes: ["512px", ...SIZES_3X],
    },
  },
  {
    id: "gemini-3.1-flash-lite-image",
    displayName: "Fast",
    tier: "fast",
    description: "Gemini 3.1 Flash-Lite Image — fastest and cheapest, 1K only.",
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 14,
      supportedAspectRatios: GEMINI_ASPECT_RATIOS,
      supportedImageSizes: ["1K"],
    },
  },
  {
    id: "gemini-3-pro-image",
    displayName: "Professional",
    tier: "professional",
    description: "Gemini 3 Pro Image — premium quality for complex edits.",
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 14,
      supportedAspectRatios: GEMINI_ASPECT_RATIOS,
      supportedImageSizes: SIZES_3X,
    },
  },
  {
    id: "gemini-2.5-flash-image",
    displayName: "Legacy",
    tier: "legacy",
    description: "Gemini 2.5 Flash Image — deprecated, shuts down 2026-10-02.",
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 3,
      supportedAspectRatios: GEMINI_ASPECT_RATIOS,
      supportedImageSizes: [],
    },
  },
];

export const DEFAULT_GEMINI_MODEL_ID = "gemini-3.1-flash-image";

export function findGeminiModel(id: string): ModelInfo | undefined {
  return GEMINI_IMAGE_MODELS.find((m) => m.id === id);
}
