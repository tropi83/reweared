import type { AspectRatio, AuthStatus, ImageMimeType, ImageSize, ModelInfo, ProviderInfo } from "@/domain/models";

export interface SourceImageInput {
  blob: Blob;
  mimeType: ImageMimeType;
}

export interface ImageGenerationRequest {
  prompt: string;
  /** Absent for pure text-to-image. */
  sourceImage?: SourceImageInput;
  model: string;
  /** Already validated against the model capabilities; "original" is never passed here. */
  aspectRatio?: Exclude<AspectRatio, "original">;
  imageSize?: ImageSize;
  outputMimeType?: "image/png" | "image/jpeg";
}

export interface ImageGenerationResult {
  image: Blob;
  mimeType: ImageMimeType;
  /** Free-form provider metadata (interaction id, usage). Never credentials. */
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
  validateCredentials(): Promise<AuthStatus>;
  generate(request: ImageGenerationRequest, options: GenerateOptions): Promise<ImageGenerationResult>;
}

/** Builds a request that only contains parameters the model supports. */
export function buildRequestForModel(
  model: ModelInfo,
  input: {
    prompt: string;
    sourceImage?: SourceImageInput;
    aspectRatio: AspectRatio;
    imageSize?: ImageSize;
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
  return request;
}
