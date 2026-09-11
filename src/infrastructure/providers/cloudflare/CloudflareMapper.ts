import { AppError } from "@/domain/models";
import type { ImageGenerationRequest } from "@/domain/services/image-provider";
import { blobToBase64 } from "@/infrastructure/providers/gemini/GeminiMapper";
import { CLOUDFLARE_OPTION_SPECS } from "./CloudflareModels";

/** Request body of `POST /accounts/{id}/ai/run/@cf/.../stable-diffusion-*` (schema verified 2026-09-11). */
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

const MAX_PROMPT_CHARS = 2000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates/normalizes the provider options against the option specs so nothing outside the
 * documented ranges is ever sent (num_steps ≤ 20, strength 0–1, …).
 */
export function normalizeCloudflareOptions(
  options: ImageGenerationRequest["options"],
): Required<Pick<CloudflareImageBody, "strength" | "guidance" | "num_steps">> & { negative_prompt?: string } {
  const get = (key: string) => options?.[key];
  const num = (key: string, fallback: number, min: number, max: number) => {
    const raw = get(key);
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    return Number.isFinite(n) ? clamp(n, min, max) : fallback;
  };
  const spec = (key: string) => CLOUDFLARE_OPTION_SPECS.find((s) => s.key === key)!;
  const strength = num("strength", spec("strength").default as number, spec("strength").min!, spec("strength").max!);
  const guidance = num("guidance", spec("guidance").default as number, spec("guidance").min!, spec("guidance").max!);
  const num_steps = Math.round(num("num_steps", spec("num_steps").default as number, spec("num_steps").min!, spec("num_steps").max!));
  const negativeRaw = get("negative_prompt");
  const negative_prompt = typeof negativeRaw === "string" ? negativeRaw.trim().slice(0, MAX_PROMPT_CHARS) : "";
  return { strength, guidance, num_steps, ...(negative_prompt ? { negative_prompt } : {}) };
}

export async function toCloudflareBody(request: ImageGenerationRequest): Promise<CloudflareImageBody> {
  const prompt = request.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) throw new AppError("INVALID_REQUEST", "Prompt is empty.");
  const body: CloudflareImageBody = { prompt, ...normalizeCloudflareOptions(request.options) };
  if (request.sourceImage) {
    if (request.sourceImage.mimeType !== "image/png" && request.sourceImage.mimeType !== "image/jpeg") {
      throw new AppError("UNSUPPORTED_FORMAT", "Cloudflare img2img expects a PNG or JPEG input.");
    }
    body.image_b64 = await blobToBase64(request.sourceImage.blob);
    // The output follows the input; passing the (already prepared, multiple-of-64) size keeps it explicit.
    if (request.sourceImage.width && request.sourceImage.height) {
      body.width = clamp(request.sourceImage.width, 256, 2048);
      body.height = clamp(request.sourceImage.height, 256, 2048);
    }
  }
  if (request.seed !== undefined) body.seed = Math.abs(Math.floor(request.seed)) % 2_147_483_647;
  return body;
}

/** 31-bit random seed so each variation of a burst differs. */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) % 2_147_483_647;
}
