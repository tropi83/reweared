import { AppError, type AuthStatus } from "@/domain/models";
import {
  buildListingCopyPrompt,
  parseListingCopy,
  resolveCopyModel,
  type ListingCopyModel,
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

const PRICING_CHECKED_ON = "2026-09-12";

/**
 * Text models with image input, cheapest first (ai.google.dev/gemini-api/docs/pricing and /models,
 * verified 2026-09-12). All of them have a free tier, unlike the image models. Prices are USD per
 * 1M tokens on the paid tier; a listing costs roughly 1,500 input + 400 output tokens, i.e. well
 * under a tenth of a cent on Flash-Lite.
 */
export const GEMINI_TEXT_MODELS: readonly ListingCopyModel[] = [
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    pricing: { inputPerM: 0.1, outputPerM: 0.4, pricingCheckedOn: PRICING_CHECKED_ON },
    freeTier: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    pricing: { inputPerM: 0.25, outputPerM: 1.5, pricingCheckedOn: PRICING_CHECKED_ON },
    freeTier: true,
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    pricing: { inputPerM: 0.3, outputPerM: 2.5, pricingCheckedOn: PRICING_CHECKED_ON },
    freeTier: true,
  },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", pricing: { inputPerM: 0.3, outputPerM: 2.5, pricingCheckedOn: PRICING_CHECKED_ON }, freeTier: true },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", pricing: { inputPerM: 0.75, outputPerM: 3.75, pricingCheckedOn: PRICING_CHECKED_ON }, freeTier: true },
];

export class GeminiListingCopyProvider implements ListingCopyProvider {
  readonly id = "gemini";
  readonly displayName = "Google Gemini";
  readonly models = GEMINI_TEXT_MODELS;

  constructor(private readonly auth: GeminiAuthSource) {}

  getAuthStatus(): Promise<AuthStatus> {
    return this.auth.getStatus();
  }

  async describeListing(request: ListingCopyRequest, { signal, model: preferred }: { signal: AbortSignal; model?: string }): Promise<ListingCopyResult> {
    const headers = await this.auth.getRequestHeaders();
    const model = resolveCopyModel(this, preferred).id;
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
