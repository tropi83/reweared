import { AppError } from "@/domain/models";
import {
  buildListingCopyPrompt,
  parseListingCopy,
  type ListingCopyProvider,
  type ListingCopyRequest,
  type ListingCopyResult,
} from "@/domain/services/listing-copy";
import { httpFetch } from "@/infrastructure/http/http-client";
import { createLogger } from "@/lib/logger";
import { mapGeminiHttpError } from "./GeminiErrors";
import { blobToBase64, extractText, type GeminiErrorBody, type InteractionResponse } from "./GeminiMapper";
import type { GeminiAuthSource } from "./GeminiProvider";

const log = createLogger("gemini-copy");

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Text (multimodal input) models in order of preference. Unlike the image models these have a
 * free tier. Ids from the Interactions API reference (verified 2026-09-11); the first one the
 * account can list is used.
 */
export const GEMINI_TEXT_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"] as const;

export class GeminiListingCopyProvider implements ListingCopyProvider {
  readonly id = "gemini";
  private resolvedModel: string | null = null;

  constructor(private readonly auth: GeminiAuthSource) {}

  private async pickModel(headers: Record<string, string>): Promise<string> {
    if (this.resolvedModel) return this.resolvedModel;
    try {
      const url = new URL(`${BASE_URL}/models`);
      url.searchParams.set("pageSize", "200");
      const response = await httpFetch(url.toString(), { headers });
      if (response.ok) {
        const json = (await response.json()) as { models?: Array<{ name?: string }> };
        const names = new Set((json.models ?? []).map((m) => (m.name ?? "").replace(/^models\//, "")));
        const found = GEMINI_TEXT_MODELS.find((id) => names.has(id));
        if (found) this.resolvedModel = found;
      }
    } catch (err) {
      log.warn("model listing failed, using default", err);
    }
    this.resolvedModel ??= GEMINI_TEXT_MODELS[0];
    return this.resolvedModel;
  }

  async describeListing(request: ListingCopyRequest, { signal }: { signal: AbortSignal }): Promise<ListingCopyResult> {
    const headers = await this.auth.getRequestHeaders();
    const model = await this.pickModel(headers);
    const body = {
      model,
      system_instruction: buildListingCopyPrompt(request),
      input: [
        { type: "text", text: "Here is the product photo. Return the JSON object only." },
        { type: "image", mime_type: request.image.mimeType, data: await blobToBase64(request.image.blob) },
      ],
      store: false,
    };
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
    if (!response.ok) {
      const error = mapGeminiHttpError(
        response.status,
        (await response.json().catch(() => undefined)) as GeminiErrorBody | undefined,
        response.headers.get("retry-after"),
      );
      log.warn("listing copy error", error.code, error.detail ?? "");
      throw error;
    }
    const json = (await response.json()) as InteractionResponse;
    return { copy: parseListingCopy(extractText(json, 8000)), providerMeta: { model } };
  }
}
