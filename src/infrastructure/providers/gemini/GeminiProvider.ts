import { AppError, type AuthStatus, type ModelInfo, type ProviderInfo } from "@/domain/models";
import type { GenerateOptions, ImageGenerationRequest, ImageGenerationResult, ImageProvider } from "@/domain/services/image-provider";
import { httpFetch } from "@/infrastructure/http/http-client";
import { createLogger } from "@/lib/logger";
import { mapGeminiHttpError, mapInteractionOutcome, parseQuotaInfo } from "./GeminiErrors";
import { extractImage, extractText, toInteractionBody, type GeminiErrorBody, type InteractionResponse } from "./GeminiMapper";
import { GEMINI_IMAGE_MODELS } from "./GeminiModels";

const log = createLogger("gemini");

export const GEMINI_PROVIDER_ID = "gemini";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Local usage accounting hook (see domain/services/usage-tracker.ts). */
export interface GeminiUsageSink {
  track(event: { provider: string; model: string; outcome: "ok" | "rate_limited" | "quota" | "error"; tokens?: number }): void;
  learnLimit(provider: string, model: string, window: "minute" | "day", value: number): void;
}

/** Minimal surface the provider needs from the auth layer. */
export interface GeminiAuthSource {
  getRequestHeaders(): Promise<Record<string, string>>;
  getStatus(): Promise<AuthStatus>;
  onCredentialRejected?(code: "INVALID_CREDENTIAL" | "AUTH_EXPIRED"): void;
}

/**
 * Gemini image generation through the Interactions API.
 * Docs: https://ai.google.dev/gemini-api/docs/image-generation (verified 2026-09-11).
 */
export class GeminiProvider implements ImageProvider {
  readonly info: ProviderInfo = { id: GEMINI_PROVIDER_ID, displayName: "Google Gemini", credentialKinds: ["oauth", "api_key"] };
  private modelCache: { at: number; models: ModelInfo[] } | null = null;

  constructor(
    private readonly auth: GeminiAuthSource,
    private readonly usage?: GeminiUsageSink,
  ) {}

  /**
   * Catalogue merged with the live model list when reachable. Unknown catalogue entries are
   * marked unavailable rather than hidden so the UI can explain why.
   */
  async getModels(): Promise<ModelInfo[]> {
    if (this.modelCache && Date.now() - this.modelCache.at < 10 * 60_000) return this.modelCache.models;
    let available: Set<string> | null = null;
    try {
      const headers = await this.auth.getRequestHeaders();
      const ids = new Set<string>();
      let pageToken: string | undefined;
      for (let page = 0; page < 5; page++) {
        const url = new URL(`${BASE_URL}/models`);
        url.searchParams.set("pageSize", "200");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const response = await httpFetch(url.toString(), { headers });
        if (!response.ok) throw await this.toError(response);
        const json = (await response.json()) as { models?: Array<{ name?: string }>; nextPageToken?: string };
        for (const m of json.models ?? []) if (m.name) ids.add(m.name.replace(/^models\//, ""));
        pageToken = json.nextPageToken;
        if (!pageToken) break;
      }
      if (ids.size > 0) available = ids;
    } catch (err) {
      log.warn("model listing unavailable, using catalogue", err);
    }
    const models = GEMINI_IMAGE_MODELS.map((m) => ({ ...m, available: available ? available.has(m.id) : true }));
    this.modelCache = { at: Date.now(), models };
    return models;
  }

  invalidateModelCache() {
    this.modelCache = null;
  }

  /** Cheap authenticated call used by "Test connection". */
  async validateCredentials(): Promise<AuthStatus> {
    const status = await this.auth.getStatus();
    if (status.state === "unauthenticated") return status;
    const headers = await this.auth.getRequestHeaders();
    const url = new URL(`${BASE_URL}/models`);
    url.searchParams.set("pageSize", "1");
    let response: Response;
    try {
      response = await httpFetch(url.toString(), { headers });
    } catch (err) {
      throw new AppError("NETWORK_ERROR", "Could not reach Gemini.", { cause: err });
    }
    if (!response.ok) throw await this.toError(response);
    this.invalidateModelCache();
    return { ...status, state: "authenticated" };
  }

  async generate(request: ImageGenerationRequest, { signal }: GenerateOptions): Promise<ImageGenerationResult> {
    const headers = await this.auth.getRequestHeaders();
    const body = await toInteractionBody(request);
    let response: Response;
    try {
      response = await httpFetch(`${BASE_URL}/interactions`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new AppError("NETWORK_ERROR", "Could not reach Gemini.", { cause: err });
    }
    if (!response.ok) throw await this.toError(response, request.model);

    const json = (await response.json()) as InteractionResponse;
    const image = extractImage(json);
    const tokens = json.usage?.total_tokens;
    this.usage?.track({ provider: GEMINI_PROVIDER_ID, model: request.model, outcome: "ok", ...(tokens !== undefined ? { tokens } : {}) });
    if (!image) {
      log.info("interaction without image", json.status ?? "unknown");
      throw mapInteractionOutcome(json.status, extractText(json));
    }
    const providerMeta: Record<string, string | number> = {};
    if (json.id) providerMeta.interactionId = json.id;
    if (tokens !== undefined) providerMeta.totalTokens = tokens;
    return { image: image.blob, mimeType: image.mimeType, providerMeta };
  }

  private async toError(response: Response, model?: string): Promise<AppError> {
    const body = (await response.json().catch(() => undefined)) as GeminiErrorBody | undefined;
    const error = mapGeminiHttpError(response.status, body, response.headers.get("retry-after"));
    if (model && this.usage) {
      const outcome =
        error.code === "RATE_LIMITED" ? "rate_limited" : error.code === "QUOTA_EXCEEDED" || error.code === "MODEL_NOT_IN_PLAN" ? "quota" : "error";
      this.usage.track({ provider: GEMINI_PROVIDER_ID, model, outcome });
      for (const v of parseQuotaInfo(body).violations) {
        if ((v.window === "minute" || v.window === "day") && v.quotaValue !== undefined) {
          this.usage.learnLimit(GEMINI_PROVIDER_ID, v.model ?? model, v.window, v.quotaValue);
        }
      }
    }
    if (error.code === "INVALID_CREDENTIAL" || error.code === "AUTH_EXPIRED") {
      this.auth.onCredentialRejected?.(error.code);
    }
    log.warn("gemini error", error.code, error.detail ?? "");
    return error;
  }
}
