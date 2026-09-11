import type { AspectRatio, ModelInfo, ProviderOptionSpec } from "@/domain/models";

/**
 * Cloudflare Workers AI image models usable for img2img.
 *
 * Sources (verified 2026-09-11):
 * - https://developers.cloudflare.com/workers-ai/models/stable-diffusion-v1-5-img2img/
 * - model JSON schemas in cloudflare/cloudflare-docs (src/content/workers-ai-models/*.json)
 * - https://developers.cloudflare.com/workers-ai/platform/pricing/ and /platform/limits/
 *
 * Facts that drive this file:
 * - Input: prompt (required), negative_prompt, image_b64, width/height 256–2048, num_steps ≤ 20
 *   (default 20), strength 0–1 (default 1), guidance (default 7.5), seed.
 * - Output: raw PNG bytes (`contentType: image/png`, `format: binary`), not JSON.
 * - Price: $0 per step for the four models below (beta). Text-to-Image limit: 720 req/min;
 *   "beta models may have lower rate limits".
 * - The model cannot change the aspect ratio by itself: the app crops/resizes the input and
 *   passes matching width/height (multiples of 64).
 */
export const CLOUDFLARE_ASPECT_RATIOS: Exclude<AspectRatio, "original">[] = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

export const CLOUDFLARE_OPTION_SPECS: ProviderOptionSpec[] = [
  { key: "strength", labelKey: "cf.option.strength", helpKey: "cf.option.strengthHelp", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.6 },
  { key: "guidance", labelKey: "cf.option.guidance", helpKey: "cf.option.guidanceHelp", type: "number", min: 1, max: 20, step: 0.5, default: 7.5 },
  { key: "num_steps", labelKey: "cf.option.steps", helpKey: "cf.option.stepsHelp", type: "number", min: 1, max: 20, step: 1, default: 20 },
  { key: "negative_prompt", labelKey: "cf.option.negativePrompt", helpKey: "cf.option.negativePromptHelp", type: "text", default: "" },
];

function sd(id: string, displayName: string, tier: ModelInfo["tier"], description: string, defaultDimension: number): ModelInfo {
  return {
    id,
    displayName,
    tier,
    description,
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 1,
      supportedAspectRatios: CLOUDFLARE_ASPECT_RATIOS,
      supportedImageSizes: ["512px", "1K"],
      inputImage: { defaultDimension, maxDimension: 1024, minDimension: 256, multipleOf: 64, cropsToAspectRatio: true },
      options: CLOUDFLARE_OPTION_SPECS,
    },
  };
}

export const CLOUDFLARE_IMAGE_MODELS: ModelInfo[] = [
  sd(
    "@cf/runwayml/stable-diffusion-v1-5-img2img",
    "Stable Diffusion 1.5 img2img",
    "fast",
    "RunwayML SD 1.5 tuned for image-to-image. Native 512px. Free (beta).",
    512,
  ),
  sd("@cf/lykon/dreamshaper-8-lcm", "DreamShaper 8 LCM", "balanced", "SD 1.5 fine-tune, fast LCM sampling, photoreal/illustration. Free.", 512),
  sd(
    "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    "Stable Diffusion XL 1.0",
    "professional",
    "SDXL base, native 1024px, best quality of the free set. Free (beta).",
    1024,
  ),
  sd("@cf/bytedance/stable-diffusion-xl-lightning", "SDXL Lightning", "fast", "Distilled SDXL, very fast at 1024px. Free (beta).", 1024),
];

export const DEFAULT_CLOUDFLARE_MODEL_ID = "@cf/runwayml/stable-diffusion-v1-5-img2img";

export function findCloudflareModel(id: string): ModelInfo | undefined {
  return CLOUDFLARE_IMAGE_MODELS.find((m) => m.id === id);
}
