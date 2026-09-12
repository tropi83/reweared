import { afterEach, describe, expect, it } from "vitest";
import { __setFetchOverride } from "@/infrastructure/http/http-client";
import { LayeredSecretStore, MemorySecretStore, WebLocalSecretStore } from "@/infrastructure/auth/SecretStore";
import { CloudflareAuth } from "@/infrastructure/providers/cloudflare/CloudflareAuth";
import { CloudflareListingCopyProvider } from "@/infrastructure/providers/cloudflare/CloudflareListingCopy";
import { GeminiListingCopyProvider } from "@/infrastructure/providers/gemini/GeminiListingCopy";
import { buildListingCopyPrompt, LISTING_COPY_JSON_SCHEMA, parseListingCopy, resolveCopyModel } from "./listing-copy";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const image = { blob: new Blob([JPEG], { type: "image/jpeg" }), mimeType: "image/jpeg" as const };

afterEach(() => __setFetchOverride(undefined));

describe("listing copy prompt & parsing", () => {
  it("includes the taxonomy, the language and the JSON contract", () => {
    const prompt = buildListingCopyPrompt({ image, category: { categoryId: "women", subcategoryId: "clothing" }, language: "fr" });
    expect(prompt).toContain("Women › Clothing");
    expect(prompt).toContain("Write in French");
    expect(prompt).toContain('"keywords"');
    expect(buildListingCopyPrompt({ image, language: "en" })).toContain("category is unknown");
    expect(LISTING_COPY_JSON_SCHEMA.required).toContain("title");
  });

  it("imposes the seller's brand (JSON-quoted) or keeps the 'only if readable' rule", () => {
    const withBrand = buildListingCopyPrompt({ image, language: "fr", brand: '  Levi\'s "501" ' });
    expect(withBrand).toContain('The seller states the brand is "Levi\'s \\"501\\""');
    expect(withBrand).not.toContain("clearly readable");
    const without = buildListingCopyPrompt({ image, language: "fr", brand: "   " });
    expect(without).toContain("only if it is clearly readable");
    expect(without).not.toContain("seller states the brand");
  });

  it("parses JSON wrapped in prose or code fences and normalizes fields", () => {
    const raw =
      'Sure! ```json\n{"title":"  Chemise blanche   cintrée ","description":"Belle chemise.\\n\\nPeu portée.","condition":"very_good","brand":null,"color":" blanc ","keywords":["Chemise","chemise","blanc","femme"]}\n```';
    const copy = parseListingCopy(raw);
    expect(copy).toEqual({
      title: "Chemise blanche cintrée",
      description: "Belle chemise.\n\nPeu portée.",
      condition: "very_good",
      color: "blanc",
      keywords: ["chemise", "blanc", "femme"],
    });
  });

  it("strips a leading '#' from keywords so the UI never shows '##'", () => {
    const copy = parseListingCopy(JSON.stringify({ title: "T", description: "D", keywords: ["#Nike", " # running ", "shoes", "#", "  "] }));
    expect(copy.keywords).toEqual(["nike", "running", "shoes"]);
  });

  it("truncates to the limits and drops unknown conditions / placeholder brands", () => {
    const copy = parseListingCopy(
      JSON.stringify({
        title: "x".repeat(100),
        description: "d".repeat(2000),
        condition: "mint",
        brand: "unknown",
        keywords: Array.from({ length: 20 }, (_, i) => `k${i}`),
      }),
    );
    expect(copy.title).toHaveLength(70);
    expect(copy.description).toHaveLength(800);
    expect(copy.condition).toBeUndefined();
    expect(copy.brand).toBeUndefined();
    expect(copy.keywords).toHaveLength(8);
  });

  it("rejects non-JSON or empty answers", () => {
    expect(() => parseListingCopy("I cannot see the image")).toThrow(/JSON/);
    expect(() => parseListingCopy('{"title":"","description":"x"}')).toThrow(/empty/);
    expect(() => parseListingCopy("{not json}")).toThrow(/malformed/);
  });
});

describe("CloudflareListingCopyProvider", () => {
  it("sends OpenAI-style messages with a data-URI image and a JSON schema, and reads result.response", async () => {
    const auth = new CloudflareAuth(new LayeredSecretStore(new MemorySecretStore(), new WebLocalSecretStore()), {
      read: async () => null,
      write: async () => undefined,
    });
    Object.defineProperty(auth, "directSupported", { get: () => true });
    await auth.saveDirect({ accountId: "0123456789abcdef0123456789abcdef", apiToken: "cf_token_1234567890abcdef", remember: false });
    const calls: Array<{ url: string; body: string }> = [];
    __setFetchOverride(async (url, init) => {
      calls.push({ url, body: String(init?.body) });
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            response: JSON.stringify({
              title: "Blue shirt",
              description: "A nice blue shirt in good condition.",
              condition: "good",
              brand: null,
              color: "blue",
              keywords: ["shirt", "blue"],
            }),
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    const provider = new CloudflareListingCopyProvider(auth);
    const result = await provider.describeListing(
      { image, language: "en", category: { categoryId: "men", subcategoryId: "clothing" } },
      { signal: new AbortController().signal },
    );
    expect(result.copy.title).toBe("Blue shirt");
    expect(result.providerMeta?.model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(calls[0]?.url).toContain("/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct");
    const body = JSON.parse(calls[0]!.body);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.max_tokens).toBeLessThanOrEqual(1024);
  });
});

describe("GeminiListingCopyProvider", () => {
  const auth = {
    getRequestHeaders: async () => ({ "x-goog-api-key": "AIzaTEST0000000000000000000000000000" }),
    getStatus: async () => ({ state: "authenticated" as const, kind: "api_key" as const }),
  };
  const answer = () =>
    new Response(
      JSON.stringify({
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [{ type: "text", text: '{"title":"T-shirt","description":"Coton, bon état.","condition":"good","color":"noir","keywords":["t-shirt"]}' }],
          },
        ],
      }),
      { status: 200 },
    );

  it("defaults to the cheapest available Flash-Lite model and sends the image through the Interactions API", async () => {
    const calls: string[] = [];
    let sentModel = "";
    __setFetchOverride(async (url, init) => {
      calls.push(url);
      const body = JSON.parse(String(init?.body));
      sentModel = body.model;
      expect(body.input[1]).toMatchObject({ type: "image", mime_type: "image/jpeg" });
      expect(body.store).toBe(false);
      return answer();
    });
    const provider = new GeminiListingCopyProvider(auth);
    expect(provider.models[0]?.id).toBe("gemini-3.1-flash-lite");
    // Retired for new accounts (404 "no longer available to new users", seen 2026-09-13): never offered again.
    expect(provider.models.map((m) => m.id)).not.toContain("gemini-2.5-flash-lite");
    expect(provider.models.every((m) => m.freeTier && m.pricing)).toBe(true);
    const result = await provider.describeListing({ image, language: "fr" }, { signal: new AbortController().signal });
    expect(sentModel).toBe("gemini-3.1-flash-lite");
    expect(result.copy.title).toBe("T-shirt");
    expect(result.providerMeta?.model).toBe("gemini-3.1-flash-lite");
    // No model listing round-trip: exactly one request.
    expect(calls).toEqual(["https://generativelanguage.googleapis.com/v1beta/interactions"]);
  });

  it("honours a chosen model and falls back to the default for unknown ids", async () => {
    const models: string[] = [];
    __setFetchOverride(async (_url, init) => {
      models.push(JSON.parse(String(init?.body)).model);
      return answer();
    });
    const provider = new GeminiListingCopyProvider(auth);
    const signal = new AbortController().signal;
    await provider.describeListing({ image, language: "en" }, { signal, model: "gemini-3.6-flash" });
    await provider.describeListing({ image, language: "en" }, { signal, model: "gemini-9-ultra" });
    // A setting saved before a model was retired keeps working on the default.
    await provider.describeListing({ image, language: "en" }, { signal, model: "gemini-2.5-flash-lite" });
    expect(models).toEqual(["gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite"]);
    expect(resolveCopyModel(provider, undefined).id).toBe("gemini-3.1-flash-lite");
    expect(() => resolveCopyModel({ models: [] }, "x")).toThrow();
  });
});
