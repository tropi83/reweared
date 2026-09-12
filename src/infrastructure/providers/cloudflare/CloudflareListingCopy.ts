import { AppError, type AuthStatus } from "@/domain/models";
import {
  blobToDataUri,
  buildListingCopyPrompt,
  LISTING_COPY_JSON_SCHEMA,
  parseListingCopy,
  resolveCopyModel,
  type ListingCopyModel,
  type ListingCopyProvider,
  type ListingCopyRequest,
  type ListingCopyResult,
} from "@/domain/services/listing-copy";
import { allowHost, httpFetch } from "@/infrastructure/http/http-client";
import { createLogger } from "@/lib/logger";
import type { CloudflareAuth } from "./CloudflareAuth";
import { mapCloudflareEnvelopeError, mapCloudflareHttpError } from "./CloudflareErrors";
import type { CloudflareErrorBody } from "./CloudflareMapper";

const log = createLogger("cloudflare-copy");

/**
 * Vision models able to describe the photo (schemas and prices verified 2026-09-12, Workers AI
 * pricing page; both count against the 10,000 free neurons/day):
 * - Llama 4 Scout: natively multimodal, supports `response_format: json_schema` (reliable JSON).
 * - Llama 3.2 11B Vision: cheaper, JSON asked in the prompt and parsed defensively.
 * Both take OpenAI-style messages with an `image_url` data URI part.
 */
export const CLOUDFLARE_VISION_MODELS: readonly ListingCopyModel[] = [
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout 17B",
    pricing: { inputPerM: 0.27, outputPerM: 0.85, pricingCheckedOn: "2026-09-12" },
    freeTier: true,
    jsonSchema: true,
  },
  {
    id: "@cf/meta/llama-3.2-11b-vision-instruct",
    label: "Llama 3.2 11B Vision",
    pricing: { inputPerM: 0.049, outputPerM: 0.676, pricingCheckedOn: "2026-09-12" },
    freeTier: true,
  },
];

export class CloudflareListingCopyProvider implements ListingCopyProvider {
  readonly id = "cloudflare";
  readonly displayName = "Cloudflare Workers AI";
  readonly models = CLOUDFLARE_VISION_MODELS;

  constructor(private readonly auth: CloudflareAuth) {}

  getAuthStatus(): Promise<AuthStatus> {
    return this.auth.getStatus();
  }

  async describeListing(request: ListingCopyRequest, { signal, model: preferred }: { signal: AbortSignal; model?: string }): Promise<ListingCopyResult> {
    const model = resolveCopyModel(this, preferred);
    const { url, headers } = await this.auth.resolveEndpoint(model.id);
    allowHost(new URL(url).host);
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: buildListingCopyPrompt(request) },
        {
          role: "user",
          content: [
            { type: "text", text: "Here is the product photo. Return the JSON object only." },
            { type: "image_url", image_url: { url: await blobToDataUri(request.image.blob, request.image.mimeType) } },
          ],
        },
      ],
      max_tokens: 700,
      temperature: 0.4,
    };
    if (model.jsonSchema) {
      body.response_format = { type: "json_schema", json_schema: LISTING_COPY_JSON_SCHEMA };
    }

    let response: Response;
    try {
      response = await httpFetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new AppError("NETWORK_ERROR", "Could not reach Cloudflare.", { cause: err });
    }
    const text = await response.text();
    let json: CloudflareErrorBody & { result?: { response?: string | Record<string, unknown> }; response?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (!response.ok) {
      const error = mapCloudflareHttpError(response.status, json.errors ? json : text, response.headers.get("retry-after"));
      log.warn("listing copy error", error.code, error.detail ?? "");
      throw error;
    }
    if (json.success === false) throw mapCloudflareEnvelopeError(json);
    const raw = json.result?.response ?? json.response;
    const rawText = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
    return { copy: parseListingCopy(rawText), providerMeta: { model: model.id } };
  }
}
