import type { AspectRatio, AuthStatus, ImageMimeType, ImageSize, ModelInfo, ProviderInfo } from "@/domain/models";

export interface SourceImageInput {
  blob: Blob;
  mimeType: ImageMimeType;
  width?: number;
  height?: number;
}

/** Provider-specific knobs (e.g. diffusion strength). Validated and defaulted by the provider. */
export type ProviderOptions = Record<string, string | number | boolean>;

export interface ImageGenerationRequest {
  prompt: string;
  /** Absent for pure text-to-image. */
  sourceImage?: SourceImageInput;
  model: string;
  /** Already validated against the model capabilities; "original" is never passed here. */
  aspectRatio?: Exclude<AspectRatio, "original">;
  imageSize?: ImageSize;
  outputMimeType?: "image/png" | "image/jpeg";
  /** Per-job random seed for providers whose output is deterministic (diffusion models). */
  seed?: number;
  options?: ProviderOptions;
}

export interface ImageGenerationResult {
  image: Blob;
  mimeType: ImageMimeType;
  /** Free-form provider metadata (interaction id, usage, seed). Never credentials. */
  providerMeta?: Record<string, string | number>;
}

export interface GenerateOptions {
  signal: AbortSignal;
}

/**
 * Provider abstraction. The domain only ever talks to this interface; HTTP details live in
 * infrastructure/providers/<provider>/.
 */
export interface ImageProvider {
  readonly info: ProviderInfo;
  getModels(): Promise<ModelInfo[]>;
  /** Local, cheap: is a usable credential configured? No network. */
  getAuthStatus(): Promise<AuthStatus>;
  /** Network round-trip that proves the credential works. */
  validateCredentials(): Promise<AuthStatus>;
  generate(request: ImageGenerationRequest, options: GenerateOptions): Promise<ImageGenerationResult>;
}

/** Pixel budget for an image size choice; used when a model wants its input pre-sized. */
export const IMAGE_SIZE_PX: Record<ImageSize, number> = { "512px": 512, "1K": 1024, "2K": 2048, "4K": 4096 };

/** Builds a request that only contains parameters the model supports. */
export function buildRequestForModel(
  model: ModelInfo,
  input: {
    prompt: string;
    sourceImage?: SourceImageInput;
    aspectRatio: AspectRatio;
    imageSize?: ImageSize;
    seed?: number;
    options?: ProviderOptions;
  },
): ImageGenerationRequest {
  const request: ImageGenerationRequest = { prompt: input.prompt, model: model.id };
  if (input.sourceImage) request.sourceImage = input.sourceImage;
  if (input.aspectRatio !== "original" && model.capabilities.supportedAspectRatios.includes(input.aspectRatio)) {
    request.aspectRatio = input.aspectRatio;
  }
  if (input.imageSize && model.capabilities.supportedImageSizes.includes(input.imageSize)) {
    request.imageSize = input.imageSize;
  }
  if (input.seed !== undefined) request.seed = input.seed;
  if (input.options && Object.keys(input.options).length > 0) request.options = input.options;
  return request;
}

/** How the source image must be prepared before being sent to a given model. */
export interface InputPreparation {
  /** Longest side after resizing. */
  maxDimension: number;
  /** Width and height rounded down to a multiple of this value (diffusion models need 8/64). */
  multipleOf?: number;
  /** Centre-crop to the requested aspect ratio when the model cannot change the ratio itself. */
  cropToAspectRatio?: Exclude<AspectRatio, "original">;
  format: "image/png" | "image/jpeg";
}

export function inputPreparationFor(
  model: ModelInfo,
  request: { aspectRatio: AspectRatio; imageSize?: ImageSize },
  fallbackMaxDimension: number,
): InputPreparation {
  const spec = model.capabilities.inputImage;
  if (!spec) return { maxDimension: fallbackMaxDimension, format: "image/png" };
  const wanted = request.imageSize ? IMAGE_SIZE_PX[request.imageSize] : spec.defaultDimension;
  const maxDimension = Math.min(spec.maxDimension, Math.max(spec.minDimension ?? 0, wanted));
  return {
    maxDimension,
    ...(spec.multipleOf ? { multipleOf: spec.multipleOf } : {}),
    ...(spec.cropsToAspectRatio && request.aspectRatio !== "original" ? { cropToAspectRatio: request.aspectRatio } : {}),
    format: "image/png",
  };
}
