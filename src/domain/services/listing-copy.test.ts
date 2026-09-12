import { afterEach, describe, expect, it } from "vitest";
import { __setFetchOverride } from "@/infrastructure/http/http-client";
import { LayeredSecretStore, MemorySecretStore, WebLocalSecretStore } from "@/infrastructure/auth/SecretStore";
import { CloudflareAuth } from "@/infrastructure/providers/cloudflare/CloudflareAuth";
import { CloudflareListingCopyProvider } from "@/infrastructure/providers/cloudflare/CloudflareListingCopy";
import { GeminiListingCopyProvider } from "@/infrastructure/providers/gemini/GeminiListingCopy";
import { buildListingCopyPrompt, LISTING_COPY_JSON_SCHEMA, parseListingCopy } from "./listing-copy";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const image = { blob: new Blob([JPEG], { type: "image/jpeg" }), mimeType: "image/jpeg" as const };

afterEach(() => __setFetchOverride(undefined));

describe("listing copy prompt & parsing", () => {
  it("includes the taxonomy, the language and the JSON contract", () => {
    const prompt = buildListingCopyPrompt({ image, listing: { categoryId: "women", subcategoryId: "clothing" }, language: "fr" });
    expect(prompt).toContain("Women › Clothing");
    expect(prompt).toContain("Write in French");
    expect(prompt).toContain('"keywords"');
    expect(buildListingCopyPrompt({ image, language: "en" })).toContain("category is unknown");
    expect(LISTING_COPY_JSON_SCHEMA.required).toContain("title");
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
      { image, language: "en", listing: { categoryId: "men", subcategoryId: "clothing" } },
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
  it("picks an available text model and sends the image through the Interactions API", async () => {
    const calls: string[] = [];
    __setFetchOverride(async (url, init) => {
      calls.push(url);
      if (url.includes("/models")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-3.5-flash" }] }), { status: 200 });
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gemini-3.5-flash");
      expect(body.input[1]).toMatchObject({ type: "image", mime_type: "image/jpeg" });
      expect(body.store).toBe(false);
      return new Response(
        JSON.stringify({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                { type: "text", text: '{"title":"T-shirt","description":"Coton, bon état.","condition":"good","color":"noir","keywords":["t-shirt"]}' },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });
    const provider = new GeminiListingCopyProvider({
      getRequestHeaders: async () => ({ "x-goog-api-key": "AIzaTEST0000000000000000000000000000" }),
      getStatus: async () => ({ state: "authenticated", kind: "api_key" }),
    });
    const result = await provider.describeListing({ image, language: "fr" }, { signal: new AbortController().signal });
    expect(result.copy.title).toBe("T-shirt");
    expect(result.providerMeta?.model).toBe("gemini-3.5-flash");
    expect(calls[1]).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
  });
});
