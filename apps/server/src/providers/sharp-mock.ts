import sharp from "sharp";
import { AppError, type AuthStatus, type ModelInfo, type ProviderInfo } from "@aiv/domain/models";
import type { GenerateOptions, ImageGenerationRequest, ImageGenerationResult, ImageProvider } from "@aiv/domain/services/image-provider";
import type { ListingCopyProvider, ListingCopyRequest, ListingCopyResult } from "@aiv/domain/services/listing-copy";
import { MOCK_COPY_MODEL_ID, MOCK_IMAGE_MODEL } from "./catalogue";

/** The client Mock's scenarios (Settings → Providers → Mock), for dev, CI and tests. */
export type MockScenario = "success" | "slow" | "flaky" | "rate_limited" | "timeout" | "error" | "no_image";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AppError("CANCELLED", "Cancelled."));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new AppError("CANCELLED", "Cancelled."));
    });
  });
}

/**
 * Server Mock image provider: returns a tinted, resized copy of the source (sharp), so the whole pipeline —
 * preparation, retries, storage, thumbnails — runs without any provider account. `scenario` and `delayMs` are
 * mutable for tests; `flaky` fails every other call with a retryable error.
 */
export class SharpMockImageProvider implements ImageProvider {
  readonly info: ProviderInfo = { id: "mock", displayName: "Mock", credentialKinds: ["none"] };
  scenario: MockScenario = "success";
  delayMs = 5;
  private calls = 0;
  readonly seeds: number[] = [];

  async getModels(): Promise<ModelInfo[]> {
    return [MOCK_IMAGE_MODEL];
  }

  async getAuthStatus(): Promise<AuthStatus> {
    return { state: "authenticated", kind: "none" };
  }

  async validateCredentials(): Promise<AuthStatus> {
    return { state: "authenticated", kind: "none" };
  }

  async generate(request: ImageGenerationRequest, options: GenerateOptions): Promise<ImageGenerationResult> {
    this.calls++;
    if (request.seed !== undefined) this.seeds.push(request.seed);
    const { signal } = options;
    await sleep(this.scenario === "slow" ? Math.max(300, this.delayMs) : this.delayMs, signal);
    switch (this.scenario) {
      case "rate_limited":
        throw new AppError("RATE_LIMITED", "Mock rate limit.", { retryAfterMs: 10 });
      case "flaky":
        if (this.calls % 2 === 1) throw new AppError("PROVIDER_UNAVAILABLE", "Mock outage.");
        break;
      case "timeout":
        await sleep(60_000, signal);
        break;
      case "error":
        throw new AppError("CONTENT_REJECTED", "Mock refusal.", { retryable: false });
      case "no_image":
        throw new AppError("NO_IMAGE_RETURNED", "Mock returned no image.");
      default:
    }
    if (!request.sourceImage) throw new AppError("INVALID_REQUEST", "The mock needs a source image.");
    const input = Buffer.from(await request.sourceImage.blob.arrayBuffer());
    const png = await sharp(input).resize({ width: 256, height: 256, fit: "inside" }).tint({ r: 255, g: 120, b: 40 }).png().toBuffer();
    return { image: new Blob([new Uint8Array(png)], { type: "image/png" }), mimeType: "image/png", providerMeta: { model: request.model } };
  }
}

/** Server Mock copy provider: a fixed, plausible title and description. */
export class MockCopyProvider implements ListingCopyProvider {
  readonly id = "mock";
  readonly displayName = "Mock";
  readonly models = [{ id: MOCK_COPY_MODEL_ID, label: "Mock", freeTier: true }];

  async getAuthStatus(): Promise<AuthStatus> {
    return { state: "authenticated", kind: "none" };
  }

  async describeListing(request: ListingCopyRequest, options: { signal: AbortSignal }): Promise<ListingCopyResult> {
    await sleep(5, options.signal);
    const french = request.language === "fr";
    return {
      copy: {
        title: french ? "Chemise en coton bleue" : "Blue cotton shirt",
        description: french ? "Chemise en coton, très bon état." : "Cotton shirt in very good condition.",
        condition: "very_good",
        ...(request.brand ? { brand: request.brand } : {}),
        color: french ? "bleu" : "blue",
        keywords: french ? ["chemise", "coton"] : ["shirt", "cotton"],
      },
      providerMeta: { model: MOCK_COPY_MODEL_ID },
    };
  }
}
