import type { ImageMimeType } from "@/domain/models";
import type { ImageGenerationRequest } from "@/domain/services/image-provider";

/**
 * Request/response shapes of the Gemini Interactions API, limited to what this app uses.
 * Reference: https://ai.google.dev/api/interactions (verified 2026-09-11).
 */
export interface InteractionTextContent {
  type: "text";
  text: string;
}

export interface InteractionImageContent {
  type: "image";
  mime_type: string;
  data?: string;
  uri?: string;
}

export type InteractionContent = InteractionTextContent | InteractionImageContent;

export interface ImageResponseFormat {
  type: "image";
  mime_type?: "image/png" | "image/jpeg";
  aspect_ratio?: string;
  image_size?: string;
}

export interface CreateInteractionBody {
  model: string;
  input: InteractionContent[];
  response_format?: ImageResponseFormat;
  /** We do not want Google to retain interactions for multi-turn state. */
  store: false;
}

export interface InteractionStep {
  type: string;
  content?: InteractionContent[];
}

export interface InteractionResponse {
  id?: string;
  status?: string;
  steps?: InteractionStep[];
  errors?: Array<{ code?: string; message?: string }>;
  usage?: { total_tokens?: number };
}

/** google.rpc.QuotaFailure / RetryInfo entries carried in `error.details` of a 429. */
export interface GeminiErrorDetail {
  "@type"?: string;
  violations?: Array<{ quotaMetric?: string; quotaId?: string; quotaValue?: string; quotaDimensions?: Record<string, string> }>;
  retryDelay?: string;
}

export interface GeminiErrorBody {
  error?: { code?: number; message?: string; status?: string; details?: GeminiErrorDetail[] };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export async function toInteractionBody(request: ImageGenerationRequest): Promise<CreateInteractionBody> {
  const input: InteractionContent[] = [{ type: "text", text: request.prompt }];
  if (request.sourceImage) {
    input.push({
      type: "image",
      mime_type: request.sourceImage.mimeType,
      data: await blobToBase64(request.sourceImage.blob),
    });
  }
  // `mime_type` is deliberately omitted unless explicitly requested: the live API rejected
  // "image/png" for gemini-3.1-flash-image (2026-09-11) even though the docs show it, so the
  // model's default output format is used and whatever MIME type comes back is handled.
  const response_format: ImageResponseFormat = { type: "image" };
  if (request.outputMimeType) response_format.mime_type = request.outputMimeType;
  if (request.aspectRatio) response_format.aspect_ratio = request.aspectRatio;
  if (request.imageSize) response_format.image_size = request.imageSize;
  return { model: request.model, input, response_format, store: false };
}

export interface ExtractedImage {
  blob: Blob;
  mimeType: ImageMimeType;
}

const OUTPUT_MIME: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Finds the first inline image in a completed interaction, or undefined. */
export function extractImage(response: InteractionResponse): ExtractedImage | undefined {
  for (const step of response.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type === "image" && content.data) {
        const mime = OUTPUT_MIME.has(content.mime_type) ? (content.mime_type as ImageMimeType) : "image/png";
        return { blob: base64ToBlob(content.data, mime), mimeType: mime };
      }
    }
  }
  return undefined;
}

/** Text the model produced alongside (or instead of) the image, for diagnostics. */
export function extractText(response: InteractionResponse, maxChars = 500): string {
  const parts: string[] = [];
  for (const step of response.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type === "text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").slice(0, maxChars);
}
