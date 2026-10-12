import { afterEach, describe, expect, it } from "vitest";
import { __setFetchOverride } from "../http";
import { CloudflareListingCopyProvider } from "./CloudflareListingCopy";
import { CLOUDFLARE_API_BASE } from "./credentials";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const image = { blob: new Blob([JPEG], { type: "image/jpeg" }), mimeType: "image/jpeg" as const };

afterEach(() => __setFetchOverride(undefined));

describe("CloudflareListingCopyProvider", () => {
  it("sends OpenAI-style messages with a data-URI image and a JSON schema, and reads result.response", async () => {
    // The worker's credentials (direct mode, from Docker secrets).
    const auth = {
      getConfig: async () => ({ mode: "direct" as const, accountId: ACCOUNT }),
      getStatus: async () => ({ state: "authenticated" as const, kind: "api_key" as const }),
      resolveEndpoint: async (modelId: string) => ({
        url: `${CLOUDFLARE_API_BASE}/accounts/${ACCOUNT}/ai/run/${modelId}`,
        headers: { Authorization: "Bearer cf_token_1234567890abcdef" },
      }),
      markRejected: () => undefined,
    };
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
