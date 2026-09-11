import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/domain/models";
import { __setFetchOverride } from "@/infrastructure/http/http-client";
import { GeminiProvider } from "./GeminiProvider";
import { mapGeminiHttpError, parseRetryAfter } from "./GeminiErrors";
import { blobToBase64, extractImage, toInteractionBody } from "./GeminiMapper";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const auth = {
  getRequestHeaders: async () => ({ "x-goog-api-key": "AIzaTESTKEYTESTKEYTESTKEY" }),
  getStatus: async () => ({ state: "authenticated" as const, kind: "api_key" as const }),
  onCredentialRejected: vi.fn(),
};

afterEach(() => {
  __setFetchOverride(undefined);
  vi.clearAllMocks();
});

describe("GeminiMapper", () => {
  it("builds an Interactions request with text, inline image and response format", async () => {
    const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" });
    const body = await toInteractionBody({
      prompt: "make it blue",
      model: "gemini-3.1-flash-image",
      sourceImage: { blob, mimeType: "image/png" },
      aspectRatio: "16:9",
      imageSize: "2K",
    });
    expect(body.model).toBe("gemini-3.1-flash-image");
    expect(body.store).toBe(false);
    expect(body.input[0]).toEqual({ type: "text", text: "make it blue" });
    expect(body.input[1]).toEqual({ type: "image", mime_type: "image/png", data: await blobToBase64(blob) });
    expect(body.response_format).toEqual({ type: "image", aspect_ratio: "16:9", image_size: "2K" });
  });

  it("omits unsupported parameters", async () => {
    const body = await toInteractionBody({ prompt: "x", model: "gemini-2.5-flash-image" });
    expect(body.input).toHaveLength(1);
    expect(body.response_format).toEqual({ type: "image" });
    expect(body.response_format).not.toHaveProperty("mime_type");
  });

  it("extracts the first image from model_output steps", () => {
    const image = extractImage({
      status: "completed",
      steps: [
        { type: "thought", content: [] },
        {
          type: "model_output",
          content: [
            { type: "text", text: "Here you go" },
            { type: "image", mime_type: "image/jpeg", data: PNG_B64 },
          ],
        },
      ],
    });
    expect(image?.mimeType).toBe("image/jpeg");
    expect(image?.blob.size).toBeGreaterThan(0);
  });
});

describe("GeminiErrors", () => {
  it("maps HTTP statuses to normalized codes", () => {
    expect(mapGeminiHttpError(429, { error: { message: "Resource exhausted, per minute" } }, "3").code).toBe("RATE_LIMITED");
    expect(mapGeminiHttpError(429, { error: { message: "You exceeded your current quota, please check your plan and billing" } }, null).code).toBe(
      "QUOTA_EXCEEDED",
    );
    expect(mapGeminiHttpError(401, undefined, null).code).toBe("INVALID_CREDENTIAL");
    expect(mapGeminiHttpError(400, { error: { message: "API key not valid. Please pass a valid API key." } }, null).code).toBe("INVALID_CREDENTIAL");
    expect(mapGeminiHttpError(403, { error: { message: "Permission denied on project" } }, null).code).toBe("PERMISSION_DENIED");
    expect(mapGeminiHttpError(404, { error: { message: "models/foo is not found" } }, null).code).toBe("MODEL_UNAVAILABLE");
    expect(mapGeminiHttpError(503, undefined, null).code).toBe("PROVIDER_UNAVAILABLE");
    expect(mapGeminiHttpError(503, undefined, null).retryable).toBe(true);
    expect(mapGeminiHttpError(400, { error: { message: "bad" } }, null).retryable).toBe(false);
  });

  it("honours Retry-After", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(mapGeminiHttpError(429, undefined, "5").retryAfterMs).toBe(5000);
  });

  it("never leaks the credential in error details", () => {
    const err = mapGeminiHttpError(400, { error: { message: "API key not valid" } }, null);
    expect(JSON.stringify(err.toJSON())).not.toContain("AIza");
  });
});

describe("GeminiProvider", () => {
  it("posts to /v1beta/interactions and returns the image", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    __setFetchOverride(async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, {
        id: "int_1",
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: PNG_B64 }] }],
        usage: { total_tokens: 42 },
      });
    });
    const provider = new GeminiProvider(auth);
    const result = await provider.generate({ prompt: "hello", model: "gemini-3.1-flash-image", aspectRatio: "1:1" }, { signal: new AbortController().signal });
    expect(result.mimeType).toBe("image/png");
    expect(result.providerMeta?.interactionId).toBe("int_1");
    expect(calls[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBeDefined();
    const body = JSON.parse(calls[0]?.init?.body as string);
    expect(body.response_format.aspect_ratio).toBe("1:1");
  });

  it("maps a 429 into a retryable RATE_LIMITED error", async () => {
    __setFetchOverride(async () => jsonResponse(429, { error: { message: "Rate limit exceeded", status: "RESOURCE_EXHAUSTED" } }, { "Retry-After": "1" }));
    const provider = new GeminiProvider(auth);
    await expect(provider.generate({ prompt: "x", model: "m" }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterMs: 1000,
    });
  });

  it("reports rejected credentials to the auth layer", async () => {
    __setFetchOverride(async () => jsonResponse(401, { error: { message: "Request had invalid authentication credentials." } }));
    const provider = new GeminiProvider(auth);
    await expect(provider.generate({ prompt: "x", model: "m" }, { signal: new AbortController().signal })).rejects.toBeInstanceOf(AppError);
    expect(auth.onCredentialRejected).toHaveBeenCalledWith("INVALID_CREDENTIAL");
  });

  it("fails with NO_IMAGE_RETURNED when the model answers with text only", async () => {
    __setFetchOverride(async () =>
      jsonResponse(200, { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Here is a description instead." }] }] }),
    );
    const provider = new GeminiProvider(auth);
    await expect(provider.generate({ prompt: "x", model: "m" }, { signal: new AbortController().signal })).rejects.toMatchObject({ code: "NO_IMAGE_RETURNED" });
  });

  it("falls back to the catalogue when model listing fails and marks availability otherwise", async () => {
    __setFetchOverride(async () => jsonResponse(500, {}));
    let models = await new GeminiProvider(auth).getModels();
    expect(models.every((m) => m.available)).toBe(true);

    __setFetchOverride(async () => jsonResponse(200, { models: [{ name: "models/gemini-3.1-flash-image" }] }));
    models = await new GeminiProvider(auth).getModels();
    expect(models.find((m) => m.id === "gemini-3.1-flash-image")?.available).toBe(true);
    expect(models.find((m) => m.id === "gemini-3-pro-image")?.available).toBe(false);
  });

  it("refuses non-allowlisted hosts", async () => {
    const { httpFetch } = await import("@/infrastructure/http/http-client");
    await expect(httpFetch("https://evil.example.com/x")).rejects.toThrow(/allowlisted/);
  });
});
