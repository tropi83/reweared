import { AppError, type ImageMimeType } from "@/domain/models";
import type { ImageGenerationRequest } from "@/domain/services/image-provider";
import { base64ToBlob, blobToBase64 } from "@/infrastructure/providers/gemini/GeminiMapper";
import { cloudflareFamilyOf, FLUX_OUTPUT, SD_OPTION_SPECS } from "./CloudflareModels";

/** Request body of `POST /accounts/{id}/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img` (schema verified 2026-09-11). */
export interface CloudflareImageBody {
  prompt: string;
  negative_prompt?: string;
  image_b64?: string;
  width?: number;
  height?: number;
  num_steps?: number;
  strength?: number;
  guidance?: number;
  seed?: number;
}

export interface CloudflareErrorBody {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: unknown[];
  result?: unknown;
}

/** Either a JSON body (Stable Diffusion) or a multipart form (FLUX.2). */
export type CloudflareRequest =
  | { kind: "json"; body: CloudflareImageBody; meta: Record<string, string | number> }
  | { kind: "multipart"; form: FormData; meta: Record<string, string | number> };

const MAX_PROMPT_CHARS = 2000;
const SEED_MODULUS = 2_147_483_647;

/** Prepended to the prompt for FLUX.2 editing so the reference image is actually used. */
export const FLUX_KEEP_SUBJECT_HINT = "Using input image 0 as the reference, keep its subject, product and details recognizable.";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numberOption(options: ImageGenerationRequest["options"], key: string): number | undefined {
  const raw = options?.[key];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Validates/normalizes the Stable Diffusion options against the option specs so nothing outside
 * the documented ranges is ever sent (num_steps ≤ 20, strength 0–1, …).
 */
export function normalizeCloudflareOptions(
  options: ImageGenerationRequest["options"],
): Required<Pick<CloudflareImageBody, "strength" | "guidance" | "num_steps">> & { negative_prompt?: string } {
  const spec = (key: string) => SD_OPTION_SPECS.find((s) => s.key === key)!;
  const num = (key: string) => {
    const s = spec(key);
    const n = numberOption(options, key);
    return n === undefined ? (s.default as number) : clamp(n, s.min!, s.max!);
  };
  const negativeRaw = options?.negative_prompt;
  const negative_prompt = typeof negativeRaw === "string" ? negativeRaw.trim().slice(0, MAX_PROMPT_CHARS) : "";
  return { strength: num("strength"), guidance: num("guidance"), num_steps: Math.round(num("num_steps")), ...(negative_prompt ? { negative_prompt } : {}) };
}

function normalizeSeed(seed: number | undefined): number | undefined {
  return seed === undefined ? undefined : Math.abs(Math.floor(seed)) % SEED_MODULUS;
}

/**
 * Output size for FLUX.2: the requested ratio (or the source's) at the requested longest side,
 * rounded to multiples of 16 within 256–1920. Unlike Stable Diffusion the model chooses the output
 * size independently of the reference image, so no cropping is needed.
 */
export function fluxOutputSize(request: ImageGenerationRequest): { width: number; height: number } {
  const longest = request.imageSize === "512px" ? 512 : 1024;
  let w = 1;
  let h = 1;
  if (request.aspectRatio) {
    [w, h] = request.aspectRatio.split(":").map(Number) as [number, number];
  } else if (request.sourceImage?.width && request.sourceImage.height) {
    w = request.sourceImage.width;
    h = request.sourceImage.height;
  }
  const scale = longest / Math.max(w, h);
  const round = (v: number) => clamp(Math.round((v * scale) / FLUX_OUTPUT.multipleOf) * FLUX_OUTPUT.multipleOf, FLUX_OUTPUT.min, FLUX_OUTPUT.max);
  return { width: round(w), height: round(h) };
}

export async function toCloudflareRequest(request: ImageGenerationRequest): Promise<CloudflareRequest> {
  const prompt = request.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) throw new AppError("INVALID_REQUEST", "Prompt is empty.");
  if (request.sourceImage && request.sourceImage.mimeType !== "image/png" && request.sourceImage.mimeType !== "image/jpeg") {
    throw new AppError("UNSUPPORTED_FORMAT", "Cloudflare expects a PNG or JPEG input.");
  }
  const family = cloudflareFamilyOf(request.model);
  const seed = normalizeSeed(request.seed);

  if (family === "flux2") {
    const form = new FormData();
    const keepSubject = request.options?.keep_subject !== false;
    form.append("prompt", keepSubject && request.sourceImage ? `${FLUX_KEEP_SUBJECT_HINT} ${prompt}` : prompt);
    if (request.sourceImage) {
      form.append("input_image_0", request.sourceImage.blob, `source.${request.sourceImage.mimeType === "image/jpeg" ? "jpg" : "png"}`);
    }
    const { width, height } = fluxOutputSize(request);
    form.append("width", String(width));
    form.append("height", String(height));
    if (seed !== undefined) form.append("seed", String(seed));
    const guidance = numberOption(request.options, "guidance");
    const meta: Record<string, string | number> = { width, height, ...(seed !== undefined ? { seed } : {}) };
    if (guidance !== undefined && guidance > 0) {
      form.append("guidance", String(clamp(guidance, 0, 10)));
      meta.guidance = clamp(guidance, 0, 10);
    }
    return { kind: "multipart", form, meta };
  }

  const body: CloudflareImageBody = { prompt, ...normalizeCloudflareOptions(request.options) };
  if (request.sourceImage) {
    body.image_b64 = await blobToBase64(request.sourceImage.blob);
    // The output follows the input; passing the (already prepared, multiple-of-64) size keeps it explicit.
    if (request.sourceImage.width && request.sourceImage.height) {
      body.width = clamp(request.sourceImage.width, 256, 2048);
      body.height = clamp(request.sourceImage.height, 256, 2048);
    }
  }
  if (seed !== undefined) body.seed = seed;
  const meta: Record<string, string | number> = { strength: body.strength ?? 1, steps: body.num_steps ?? 20, ...(seed !== undefined ? { seed } : {}) };
  return { kind: "json", body, meta };
}

/** Back-compat helper used by tests and the Worker docs: the JSON body for Stable Diffusion. */
export async function toCloudflareBody(request: ImageGenerationRequest): Promise<CloudflareImageBody> {
  const req = await toCloudflareRequest({ ...request, model: "@cf/runwayml/stable-diffusion-v1-5-img2img" });
  if (req.kind !== "json") throw new Error("unreachable");
  return req.body;
}

export interface DecodedImageResponse {
  blob: Blob;
  mimeType: ImageMimeType;
}

/**
 * Workers AI image models answer either with raw PNG bytes (Stable Diffusion) or with the v4 JSON
 * envelope carrying a base64 `image` (FLUX). Returns undefined when the JSON is an error envelope.
 */
export async function decodeImageResponse(response: Response): Promise<DecodedImageResponse | { envelope: CloudflareErrorBody }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await response.json().catch(() => ({}))) as CloudflareErrorBody & { result?: { image?: string }; image?: string };
    const b64 = json.result?.image ?? json.image;
    if (typeof b64 === "string" && b64.length > 0) {
      const mime: ImageMimeType = b64.startsWith("/9j/") ? "image/jpeg" : "image/png";
      return { blob: base64ToBlob(b64, mime), mimeType: mime };
    }
    return { envelope: json };
  }
  const bytes = await response.arrayBuffer();
  const mime: ImageMimeType = contentType.includes("image/jpeg") ? "image/jpeg" : "image/png";
  return { blob: new Blob([bytes], { type: mime }), mimeType: mime };
}

/** 31-bit random seed so each variation of a burst differs. */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) % SEED_MODULUS;
}
