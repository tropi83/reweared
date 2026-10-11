import { afterEach, describe, expect, it } from "vitest";
import { __setFetchOverride } from "@/infrastructure/http/http-client";
import { LayeredSecretStore, MemorySecretStore, WebLocalSecretStore } from "@/infrastructure/auth/SecretStore";
import { CloudflareAuth } from "./CloudflareAuth";
import { CloudflareListingCopyProvider } from "./CloudflareListingCopy";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const image = { blob: new Blob([JPEG], { type: "image/jpeg" }), mimeType: "image/jpeg" as const };

afterEach(() => __setFetchOverride(undefined));

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
