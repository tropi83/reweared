import { afterEach, describe, expect, it } from "vitest";
import { resolveCopyModel } from "@/domain/services/listing-copy";
import { __setFetchOverride } from "@/infrastructure/http/http-client";
import { GeminiListingCopyProvider } from "./GeminiListingCopy";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const image = { blob: new Blob([JPEG], { type: "image/jpeg" }), mimeType: "image/jpeg" as const };

afterEach(() => __setFetchOverride(undefined));

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
