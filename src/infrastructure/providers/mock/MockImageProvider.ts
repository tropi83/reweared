import { AppError, type AuthStatus, type ModelInfo, type ProviderInfo, ALL_ASPECT_RATIOS } from "@/domain/models";
import type { GenerateOptions, ImageGenerationRequest, ImageGenerationResult, ImageProvider } from "@/domain/services/image-provider";
import { sleep } from "@/lib/retry";

export type MockScenario = "success" | "slow" | "flaky" | "rate_limited" | "timeout" | "error" | "no_image";

export interface MockProviderOptions {
  scenario?: MockScenario;
  /** Base latency in ms (jittered ±50%). */
  latencyMs?: number;
  random?: () => number;
  /** Optional local usage accounting, mirrors the Gemini provider. */
  usage?: { track(event: { provider: string; model: string; outcome: "ok" | "rate_limited" | "quota" | "error" }): void };
}

export const MOCK_PROVIDER_ID = "mock";

const MOCK_MODELS: ModelInfo[] = [
  {
    id: "mock-fast",
    displayName: "Mock Fast",
    tier: "fast",
    description: "Instant placeholder images.",
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 1,
      supportedAspectRatios: ALL_ASPECT_RATIOS.filter((r) => r !== "original"),
      supportedImageSizes: ["512px", "1K"],
    },
  },
  {
    id: "mock-pro",
    displayName: "Mock Professional",
    tier: "professional",
    description: "Slower placeholder images.",
    available: true,
    capabilities: {
      imageGeneration: true,
      imageEditing: true,
      maxInputImages: 1,
      supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
      supportedImageSizes: ["1K", "2K", "4K"],
    },
  },
];

const HUES = [265, 200, 330, 150, 30, 100, 0, 220];

/**
 * Development provider. Produces a tinted, labelled copy of the source image (or a gradient)
 * without any network call, and can simulate every failure mode the queue must handle.
 */
export class MockImageProvider implements ImageProvider {
  readonly info: ProviderInfo = { id: MOCK_PROVIDER_ID, displayName: "Mock (development)", credentialKinds: ["none"] };
  private counter = 0;

  constructor(private options: MockProviderOptions = {}) {}

  setOptions(options: MockProviderOptions) {
    this.options = { ...this.options, ...options };
  }

  async getModels(): Promise<ModelInfo[]> {
    return MOCK_MODELS;
  }

  async validateCredentials(): Promise<AuthStatus> {
    return { state: "authenticated", kind: "none", label: "Mock provider" };
  }

  async generate(request: ImageGenerationRequest, { signal }: GenerateOptions): Promise<ImageGenerationResult> {
    const random = this.options.random ?? Math.random;
    const scenario = this.options.scenario ?? "success";
    const base = this.options.latencyMs ?? 1200;
    const latency = scenario === "slow" ? base * 3 : base;
    const n = ++this.counter;

    if (scenario === "timeout") {
      await sleep(10 * 60_000, signal);
    }
    await sleep(Math.round(latency * (0.5 + random())), signal);

    const track = (outcome: "ok" | "rate_limited" | "quota" | "error") =>
      this.options.usage?.track({ provider: MOCK_PROVIDER_ID, model: request.model, outcome });
    if (scenario === "error") {
      track("error");
      throw new AppError("CONTENT_REJECTED", "Mock: content rejected.");
    }
    if (scenario === "no_image") {
      track("error");
      throw new AppError("NO_IMAGE_RETURNED", "Mock: model returned text only.");
    }
    if (scenario === "rate_limited" && n % 2 === 1) {
      track("rate_limited");
      throw new AppError("RATE_LIMITED", "Mock: rate limited.", { retryAfterMs: 800, detail: "HTTP 429" });
    }
    if (scenario === "flaky" && random() < 0.35) {
      track("error");
      throw new AppError(random() < 0.5 ? "PROVIDER_UNAVAILABLE" : "NETWORK_ERROR", "Mock: transient failure.");
    }

    track("ok");
    const image = await renderMockImage(request, n, random);
    return { image, mimeType: "image/png", providerMeta: { mock: n } };
  }
}

async function renderMockImage(request: ImageGenerationRequest, n: number, random: () => number): Promise<Blob> {
  const hue = HUES[n % HUES.length] ?? 265;
  const { width, height } = await targetDimensions(request);

  if (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") {
    return new Blob([TINY_PNG], { type: "image/png" });
  }
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) return new Blob([TINY_PNG], { type: "image/png" });

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${hue} 60% 22%)`);
  gradient.addColorStop(1, `hsl(${(hue + 40) % 360} 70% 45%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (request.sourceImage) {
    try {
      const bitmap = await createImageBitmap(request.sourceImage.blob);
      const scale = Math.min(width / bitmap.width, height / bitmap.height);
      const dw = bitmap.width * scale;
      const dh = bitmap.height * scale;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(bitmap, (width - dw) / 2, (height - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
      bitmap.close();
      ctx.fillStyle = `hsl(${hue} 80% 55% / 0.25)`;
      ctx.fillRect(0, 0, width, height);
    } catch {
      // Source could not be decoded; keep the gradient.
    }
  }

  // Decorative blobs so each variation is visibly different.
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.fillStyle = `hsl(${(hue + i * 37) % 360} 80% 60% / 0.35)`;
    ctx.arc(random() * width, random() * height, (0.05 + random() * 0.15) * Math.min(width, height), 0, Math.PI * 2);
    ctx.fill();
  }

  const label = `MOCK #${n}`;
  ctx.font = `bold ${Math.round(Math.min(width, height) / 12)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 120));
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(label, width / 2, height / 2);
  ctx.fillStyle = "white";
  ctx.fillText(label, width / 2, height / 2);

  return canvasToBlob(canvas);
}

/** Mirrors Gemini: an explicit aspect ratio wins, otherwise the output follows the source image. */
async function targetDimensions(request: ImageGenerationRequest): Promise<{ width: number; height: number }> {
  const longest = request.imageSize === "4K" ? 2048 : request.imageSize === "2K" ? 1536 : request.imageSize === "512px" ? 512 : 1024;
  let w = 1;
  let h = 1;
  if (request.aspectRatio) {
    [w, h] = request.aspectRatio.split(":").map(Number) as [number, number];
  } else if (request.sourceImage && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(request.sourceImage.blob);
      w = bitmap.width;
      h = bitmap.height;
      bitmap.close();
    } catch {
      /* keep square */
    }
  }
  if (w >= h) return { width: longest, height: Math.round((longest * h) / w) };
  return { width: Math.round((longest * w) / h), height: longest };
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}

/** 1x1 transparent PNG, used when no canvas implementation exists (tests). */
const TINY_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) =>
  c.charCodeAt(0),
);
