import type { AspectRatio, ModelInfo, ProviderOptionSpec } from "@/domain/models";

/**
 * Cloudflare Workers AI models that accept a source image.
 *
 * Sources (verified 2026-09-12):
 * - https://developers.cloudflare.com/changelog/2026-01-15-flux-2-klein-4b-workers-ai/ (multipart API,
 *   `input_image_0..3`, width/height 256–1920, steps fixed at 4, reference images smaller than 512×512)
 * - https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/ (pricing per 512×512 tile)
 * - https://developers.cloudflare.com/workers-ai/models/stable-diffusion-v1-5-img2img/ (JSON API, PNG output)
 * - https://developers.cloudflare.com/workers-ai/platform/pricing/ (10,000 neurons/day free, $0.011 / 1,000 neurons)
 * - https://developers.cloudflare.com/workers-ai/platform/errors/ (5018 private model, 3030 invalid input, 3036 neurons)
 *
 * Why only these two families:
 * - FLUX.2 [klein] unifies generation and editing: the source goes in as `input_image_0`, the
 *   output size is free (so aspect ratios are honoured natively). 4B ≈ 110 neurons per 1K image,
 *   i.e. roughly 90 images/day inside the free daily allocation; 9B is priced per megapixel and
 *   burns the allocation in a handful of images.
 * - `stable-diffusion-v1-5-img2img` is the only Stable Diffusion deployment with an `image`
 *   tensor; SDXL base/lightning and DreamShaper share the same *documented* schema but reject
 *   images with error 3030 ("input tensor `image` is not present in the model"). Cloudflare also
 *   answers 5018 (private model) for the img2img model on many accounts, so it is listed last.
 */
export type CloudflareFamily = "flux2" | "sd15";

export const CLOUDFLARE_ASPECT_RATIOS: Exclude<AspectRatio, "original">[] = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

export const FLUX_OPTION_SPECS: ProviderOptionSpec[] = [
  { key: "keep_subject", labelKey: "cf.option.keepSubject", helpKey: "cf.option.keepSubjectHelp", type: "boolean", default: true },
  { key: "guidance", labelKey: "cf.option.guidance", helpKey: "cf.option.fluxGuidanceHelp", type: "number", min: 0, max: 10, step: 0.5, default: 0 },
];

export const SD_OPTION_SPECS: ProviderOptionSpec[] = [
  { key: "strength", labelKey: "cf.option.strength", helpKey: "cf.option.strengthHelp", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.6 },
  { key: "guidance", labelKey: "cf.option.guidance", helpKey: "cf.option.guidanceHelp", type: "number", min: 1, max: 20, step: 0.5, default: 7.5 },
  { key: "num_steps", labelKey: "cf.option.steps", helpKey: "cf.option.stepsHelp", type: "number", min: 1, max: 20, step: 1, default: 20 },
  { key: "negative_prompt", labelKey: "cf.option.negativePrompt", helpKey: "cf.option.negativePromptHelp", type: "text", default: "" },
];

/** FLUX.2 [klein] output bounds from the launch changelog. */
export const FLUX_OUTPUT = { min: 256, max: 1920, multipleOf: 16 } as const;
/** Reference images "must be smaller than 512x512". */
export const FLUX_REFERENCE_MAX = 512;

const FAMILY_BY_ID: Record<string, CloudflareFamily> = {
  "@cf/black-forest-labs/flux-2-klein-4b": "flux2",
  "@cf/black-forest-labs/flux-2-klein-9b": "flux2",
  "@cf/runwayml/stable-diffusion-v1-5-img2img": "sd15",
};

export function cloudflareFamilyOf(modelId: string): CloudflareFamily | undefined {
  return FAMILY_BY_ID[modelId];
}

export const CLOUDFLARE_IMAGE_MODELS: ModelInfo[] = [
  {
    id: "@cf/black-forest-labs/flux-2-klein-4b",
    displayName: "FLUX.2 [klein] 4B",
    tier: "balanced",
    description:
      "Black Forest Labs, generation + editing from a reference image. ≈110 neurons per 1K image → about 90 images/day within Cloudflare's free 10,000 neurons.",
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 4,
      supportedAspectRatios: CLOUDFLARE_ASPECT_RATIOS,
      supportedImageSizes: ["512px", "1K"],
      inputImage: { defaultDimension: FLUX_REFERENCE_MAX, maxDimension: FLUX_REFERENCE_MAX, minDimension: 256, multipleOf: 16, cropsToAspectRatio: false },
      options: FLUX_OPTION_SPECS,
    },
  },
  {
    id: "@cf/black-forest-labs/flux-2-klein-9b",
    displayName: "FLUX.2 [klein] 9B",
    tier: "professional",
    description: "Higher quality, priced per megapixel (≈1,400 neurons per 1K image): only a few images/day stay within the free allocation.",
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 4,
      supportedAspectRatios: CLOUDFLARE_ASPECT_RATIOS,
      supportedImageSizes: ["512px", "1K"],
      inputImage: { defaultDimension: FLUX_REFERENCE_MAX, maxDimension: FLUX_REFERENCE_MAX, minDimension: 256, multipleOf: 16, cropsToAspectRatio: false },
      options: FLUX_OPTION_SPECS,
    },
  },
  {
    id: "@cf/runwayml/stable-diffusion-v1-5-img2img",
    displayName: "Stable Diffusion 1.5 img2img",
    tier: "legacy",
    description: "RunwayML SD 1.5 img2img, $0 per step (beta). Cloudflare restricts it to some accounts (error 5018).",
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 1,
      supportedAspectRatios: CLOUDFLARE_ASPECT_RATIOS,
      supportedImageSizes: ["512px", "1K"],
      inputImage: { defaultDimension: 512, maxDimension: 1024, minDimension: 256, multipleOf: 64, cropsToAspectRatio: true },
      options: SD_OPTION_SPECS,
    },
  },
];

export const DEFAULT_CLOUDFLARE_MODEL_ID = "@cf/black-forest-labs/flux-2-klein-4b";

export function findCloudflareModel(id: string): ModelInfo | undefined {
  return CLOUDFLARE_IMAGE_MODELS.find((m) => m.id === id);
}
