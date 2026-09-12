import { AppError, type ListingCondition, type ListingCopy, type ListingSelection, type Locale } from "@/domain/models";
import { findSubcategory } from "./listing-catalog";

export interface ListingCopyRequest {
  image: { blob: Blob; mimeType: "image/png" | "image/jpeg" };
  listing?: ListingSelection;
  language: Locale;
}

export interface ListingCopyResult {
  copy: Omit<ListingCopy, "generatedAt" | "provider" | "model" | "language">;
  providerMeta?: Record<string, string | number>;
}

/**
 * A vision model that turns the original photo into marketplace copy. Implemented by providers
 * that can look at images (Cloudflare Llama 4 Scout, Gemini Flash).
 */
export interface ListingCopyProvider {
  readonly id: string;
  describeListing(request: ListingCopyRequest, options: { signal: AbortSignal }): Promise<ListingCopyResult>;
}

export const LISTING_COPY_LIMITS = { title: 70, description: 800, keywords: 8 } as const;

const CONDITIONS: ListingCondition[] = ["new_with_tags", "new", "very_good", "good", "satisfactory"];

const LANGUAGE_NAME: Record<Locale, string> = { en: "English", fr: "French" };

/** Shared instruction so every provider produces the same fields; JSON only. */
export function buildListingCopyPrompt(request: ListingCopyRequest): string {
  const found = request.listing ? findSubcategory(request.listing) : undefined;
  const context = found
    ? `The seller filed it under "${found.category.label.en} › ${found.subcategory.label.en}" (${found.subcategory.subject}).`
    : "The category is unknown.";
  return [
    "You write second-hand marketplace listings (like Vinted or eBay) from a single product photo.",
    context,
    `Write in ${LANGUAGE_NAME[request.language]}.`,
    "Be factual: describe only what is visible. Mention the type of item, color, material or fabric when recognizable, visible pattern, notable features, and the visible condition (wear, marks, pilling, scratches). Never invent a size, brand, model or year; put the brand only if it is clearly readable in the photo, otherwise null.",
    `Return ONLY a JSON object with these keys: "title" (max ${LISTING_COPY_LIMITS.title} characters, no emojis, no price), "description" (80 to 130 words, friendly and honest, plain text with short paragraphs), "condition" (one of ${CONDITIONS.map((c) => `"${c}"`).join(", ")}), "brand" (string or null), "color" (short string), "keywords" (array of 5 to ${LISTING_COPY_LIMITS.keywords} lowercase search keywords).`,
  ].join(" ");
}

/** JSON schema used by providers that support constrained output. */
export const LISTING_COPY_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: LISTING_COPY_LIMITS.title },
    description: { type: "string" },
    condition: { type: "string", enum: CONDITIONS },
    brand: { type: ["string", "null"] },
    color: { type: "string" },
    keywords: { type: "array", items: { type: "string" }, maxItems: LISTING_COPY_LIMITS.keywords },
  },
  required: ["title", "description", "condition", "color", "keywords"],
  additionalProperties: false,
} as const;

/** Extracts and validates the JSON object a model returned (tolerates fenced code and prose around it). */
export function parseListingCopy(raw: string): ListingCopyResult["copy"] {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AppError("INVALID_REQUEST", "The model did not return JSON.", { detail: text.slice(0, 120) });
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new AppError("INVALID_REQUEST", "The model returned malformed JSON.", { detail: text.slice(0, 120) });
  }
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const title = str(json.title).slice(0, LISTING_COPY_LIMITS.title);
  const description = typeof json.description === "string" ? json.description.trim().slice(0, LISTING_COPY_LIMITS.description) : "";
  if (!title || !description) throw new AppError("INVALID_REQUEST", "The model returned an empty title or description.");
  const condition = CONDITIONS.includes(json.condition as ListingCondition) ? (json.condition as ListingCondition) : undefined;
  const brand = str(json.brand);
  const color = str(json.color);
  const keywords = Array.isArray(json.keywords)
    ? [
        ...new Set(
          json.keywords
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, LISTING_COPY_LIMITS.keywords)
    : [];
  return {
    title,
    description,
    ...(condition ? { condition } : {}),
    ...(brand && brand.toLowerCase() !== "null" && brand.toLowerCase() !== "unknown" ? { brand: brand.slice(0, 60) } : {}),
    ...(color ? { color: color.slice(0, 40) } : {}),
    keywords,
  };
}

export async function blobToDataUri(blob: Blob, mimeType: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mimeType};base64,${btoa(binary)}`;
}
