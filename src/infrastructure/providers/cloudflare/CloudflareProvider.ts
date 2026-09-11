import { AppError, type AuthStatus, type ModelInfo, type ProviderInfo } from "@/domain/models";
import type { GenerateOptions, ImageGenerationRequest, ImageGenerationResult, ImageProvider } from "@/domain/services/image-provider";
import { allowHost, httpFetch } from "@/infrastructure/http/http-client";
import { createLogger } from "@/lib/logger";
import type { GeminiUsageSink } from "../gemini/GeminiProvider";
import type { CloudflareAuth } from "./CloudflareAuth";
import { cloudflareMessageFor, mapCloudflareEnvelopeError, mapCloudflareHttpError } from "./CloudflareErrors";
import { toCloudflareBody, type CloudflareErrorBody } from "./CloudflareMapper";
import { CLOUDFLARE_IMAGE_MODELS, findCloudflareModel } from "./CloudflareModels";

const log = createLogger("cloudflare");

export const CLOUDFLARE_PROVIDER_ID = "cloudflare";

/** Hard cap on the PNG we accept back (2048² PNG is well below this). */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * Cloudflare Workers AI image models (Stable Diffusion img2img family).
 * Docs: https://developers.cloudflare.com/workers-ai/models/stable-diffusion-v1-5-img2img/ (verified 2026-09-11).
 */
export class CloudflareProvider implements ImageProvider {
  readonly info: ProviderInfo = {
    id: CLOUDFLARE_PROVIDER_ID,
    displayName: "Cloudflare Workers AI",
    credentialKinds: ["api_token"],
    pricingKey: "cf.pricing",
  };

  constructor(
    private readonly auth: CloudflareAuth,
    private readonly usage?: GeminiUsageSink,
  ) {}

  async getModels(): Promise<ModelInfo[]> {
    return CLOUDFLARE_IMAGE_MODELS;
  }

  getAuthStatus(): Promise<AuthStatus> {
    return this.auth.getStatus();
  }

  /**
   * "Test connection": one real run of the cheapest call is the only documented way to prove a
   * token works for Workers AI, but that would spend a generation. We instead call the models
   * listing (direct mode) or the Worker's health route, which both need the credential.
   */
  async validateCredentials(): Promise<AuthStatus> {
    const status = await this.auth.getStatus();
    if (status.state === "unauthenticated") return status;
    const cfg = await this.auth.getConfig();
    const { headers } = await this.auth.resolveEndpoint(CLOUDFLARE_IMAGE_MODELS[0]!.id);
    const url =
      cfg?.mode === "direct"
        ? `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai/models/search?task=Text-to-Image&per_page=1`
        : `${cfg?.workerUrl}/health`;
    if (cfg?.mode === "worker" && cfg.workerUrl) allowHost(new URL(cfg.workerUrl).host);
    let response: Response;
    try {
      response = await httpFetch(url, { headers });
    } catch (err) {
      throw new AppError("NETWORK_ERROR", "Could not reach Cloudflare.", { cause: err });
    }
    if (!response.ok) throw await this.toError(response);
    return { ...status, state: "authenticated" };
  }

  async generate(request: ImageGenerationRequest, { signal }: GenerateOptions): Promise<ImageGenerationResult> {
    if (!findCloudflareModel(request.model)) throw new AppError("MODEL_UNAVAILABLE", cloudflareMessageFor("MODEL_UNAVAILABLE"));
    if (!request.sourceImage) throw new AppError("INVALID_REQUEST", "This model needs a source image.");
    const { url, headers } = await this.auth.resolveEndpoint(request.model);
    allowHost(new URL(url).host);
    const body = await toCloudflareBody(request);

    let response: Response;
    try {
      response = await httpFetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "image/png, application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new AppError("NETWORK_ERROR", "Could not reach Cloudflare.", { cause: err });
    }
    if (!response.ok) throw await this.toError(response, request.model);

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // Workers AI answers image models with raw PNG; JSON on a 200 means the v4 envelope carried an error.
      const envelope = (await response.json().catch(() => ({}))) as CloudflareErrorBody;
      this.track(request.model, "error");
      throw mapCloudflareEnvelopeError(envelope);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) {
      this.track(request.model, "error");
      throw new AppError("NO_IMAGE_RETURNED", "Cloudflare returned an empty or oversized image.");
    }
    const mime = contentType.includes("image/jpeg") ? "image/jpeg" : "image/png";
    this.track(request.model, "ok");
    return {
      image: new Blob([bytes], { type: mime }),
      mimeType: mime,
      providerMeta: { ...(body.seed !== undefined ? { seed: body.seed } : {}), strength: body.strength ?? 1, steps: body.num_steps ?? 20 },
    };
  }

  private track(model: string, outcome: "ok" | "rate_limited" | "quota" | "error") {
    this.usage?.track({ provider: CLOUDFLARE_PROVIDER_ID, model, outcome });
  }

  private async toError(response: Response, model?: string): Promise<AppError> {
    const text = await response.text().catch(() => "");
    let body: CloudflareErrorBody | string | undefined = text;
    try {
      body = JSON.parse(text) as CloudflareErrorBody;
    } catch {
      /* plain text */
    }
    const error = mapCloudflareHttpError(response.status, body, response.headers.get("retry-after"));
    if (model) this.track(model, error.code === "RATE_LIMITED" ? "rate_limited" : error.code === "QUOTA_EXCEEDED" ? "quota" : "error");
    if (error.code === "INVALID_CREDENTIAL") this.auth.markRejected();
    log.warn("cloudflare error", error.code, error.detail ?? "");
    return error;
  }
}
