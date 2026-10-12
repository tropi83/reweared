import type { ModelInfo } from "@aiv/domain/models";
import { CLOUDFLARE_IMAGE_MODELS } from "@aiv/providers/cloudflare/CloudflareModels";
import { CLOUDFLARE_VISION_MODELS } from "@aiv/providers/cloudflare/CloudflareListingCopy";
import { GEMINI_TEXT_MODELS } from "@aiv/providers/gemini/GeminiListingCopy";
import { GEMINI_IMAGE_MODELS } from "@aiv/providers/gemini/GeminiModels";

export type ImageProviderId = "cloudflare" | "gemini" | "mock";
export type CopyProviderId = "gemini" | "cloudflare" | "mock";

/** The server's Mock image model: same input preparation as FLUX.2 [klein] so the pipeline is exercised the same way. */
export const MOCK_IMAGE_MODEL: ModelInfo = {
  id: "mock-image",
  displayName: "Mock",
  tier: "fast",
  available: true,
  capabilities: {
    imageGeneration: true,
    imageEditing: true,
    maxInputImages: 1,
    supportedAspectRatios: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"],
    supportedImageSizes: [],
    inputImage: { defaultDimension: 1024, maxDimension: 512, multipleOf: 16 },
  },
};
export const MOCK_COPY_MODEL_ID = "mock-copy";

/** The platform's image model (configuration, never a user choice); unknown ids fail at startup. */
export function platformImageModel(provider: ImageProviderId, modelId: string): ModelInfo {
  const catalogue = provider === "cloudflare" ? CLOUDFLARE_IMAGE_MODELS : provider === "gemini" ? GEMINI_IMAGE_MODELS : [MOCK_IMAGE_MODEL];
  const model = catalogue.find((m) => m.id === modelId);
  if (!model) throw new Error(`IMAGE_MODEL ${modelId} is not in the ${provider} catalogue`);
  return model;
}

export function assertPlatformCopyModel(provider: CopyProviderId, modelId: string): void {
  const ids =
    provider === "gemini" ? GEMINI_TEXT_MODELS.map((m) => m.id) : provider === "cloudflare" ? CLOUDFLARE_VISION_MODELS.map((m) => m.id) : [MOCK_COPY_MODEL_ID];
  if (!ids.includes(modelId)) throw new Error(`COPY_MODEL ${modelId} is not in the ${provider} catalogue`);
}

/**
 * Estimated Workers AI neurons for one image job (pricing page, checked 2026-10-12): FLUX.2 [klein] 4B ≈ 26 per
 * output 512² tile and 5.4 per input tile — about 110 for a 1K image with a 512 px reference; 9B ≈ 1,364 per first MP.
 */
export function estimatedNeurons(provider: ImageProviderId, modelId: string): number {
  if (provider !== "cloudflare") return 0;
  if (modelId.endsWith("flux-2-klein-9b")) return 1400;
  return 110;
}
