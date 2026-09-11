import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setFetchOverride } from "@/infrastructure/http/http-client";
import { LayeredSecretStore, MemorySecretStore, WebLocalSecretStore } from "@/infrastructure/auth/SecretStore";
import { inputPreparationFor } from "@/domain/services/image-provider";
import { computeGeometry } from "@/infrastructure/image/image-processing";
import { CloudflareAuth, normalizeWorkerUrl, type MetaStore } from "./CloudflareAuth";
import { mapCloudflareEnvelopeError, mapCloudflareHttpError } from "./CloudflareErrors";
import { normalizeCloudflareOptions, randomSeed, toCloudflareBody } from "./CloudflareMapper";
import { CLOUDFLARE_IMAGE_MODELS, DEFAULT_CLOUDFLARE_MODEL_ID } from "./CloudflareModels";
import { CloudflareProvider } from "./CloudflareProvider";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function meta(): MetaStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    read: async <T>(key: string) => (data[key] as T | undefined) ?? null,
    write: async (key: string, value: unknown) => {
      data[key] = value;
    },
  };
}

function makeAuth(desktop = true) {
  vi.spyOn(CloudflareAuth.prototype, "directSupported", "get").mockReturnValue(desktop);
  return new CloudflareAuth(new LayeredSecretStore(new MemorySecretStore(), new WebLocalSecretStore()), meta());
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  __setFetchOverride(undefined);
  vi.restoreAllMocks();
});

describe("CloudflareMapper", () => {
  it("normalizes options into the documented ranges and defaults", () => {
    expect(normalizeCloudflareOptions(undefined)).toEqual({ strength: 0.6, guidance: 7.5, num_steps: 20 });
    expect(normalizeCloudflareOptions({ strength: 5, guidance: -3, num_steps: 99, negative_prompt: "  blurry " })).toEqual({
      strength: 1,
      guidance: 1,
      num_steps: 20,
      negative_prompt: "blurry",
    });
    expect(normalizeCloudflareOptions({ strength: "0.4", num_steps: "abc" })).toMatchObject({ strength: 0.4, num_steps: 20 });
  });

  it("builds the REST body with base64 image, explicit size and seed", async () => {
    const blob = new Blob([PNG], { type: "image/png" });
    const body = await toCloudflareBody({
      prompt: "  studio shot ",
      model: DEFAULT_CLOUDFLARE_MODEL_ID,
      sourceImage: { blob, mimeType: "image/png", width: 512, height: 768 },
      seed: 2_147_483_647 + 5,
      options: { strength: 0.5 },
    });
    expect(body.prompt).toBe("studio shot");
    expect(body.image_b64).toBeTruthy();
    expect(body).toMatchObject({ width: 512, height: 768, strength: 0.5, guidance: 7.5, num_steps: 20, seed: 5 });
    expect(body).not.toHaveProperty("negative_prompt");
  });

  it("rejects unsupported input formats and empty prompts", async () => {
    await expect(toCloudflareBody({ prompt: "x", model: "m", sourceImage: { blob: new Blob(), mimeType: "image/webp" } })).rejects.toMatchObject({
      code: "UNSUPPORTED_FORMAT",
    });
    await expect(toCloudflareBody({ prompt: "   ", model: "m" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("produces distinct 31-bit seeds", () => {
    const seeds = new Set(Array.from({ length: 20 }, randomSeed));
    expect(seeds.size).toBeGreaterThan(15);
    for (const s of seeds) expect(s).toBeLessThan(2_147_483_647);
  });
});

describe("CloudflareErrors", () => {
  it("maps the v4 envelope codes", () => {
    expect(mapCloudflareHttpError(400, { success: false, errors: [{ code: 9106, message: "Authentication failed (status: 400)" }] }, null).code).toBe(
      "INVALID_CREDENTIAL",
    );
    expect(
      mapCloudflareHttpError(
        404,
        { errors: [{ code: 7003, message: "Could not route to /client/v4/accounts/x, perhaps your object identifier is invalid?" }] },
        null,
      ).code,
    ).toBe("INVALID_CREDENTIAL");
    expect(mapCloudflareHttpError(404, { errors: [{ code: 5007, message: "No such model" }] }, null).code).toBe("MODEL_UNAVAILABLE");
    expect(mapCloudflareHttpError(429, { errors: [{ message: "Rate limit exceeded" }] }, "7").retryAfterMs).toBe(7000);
    expect(mapCloudflareHttpError(429, { errors: [{ message: "Daily neuron allocation exceeded" }] }, null).code).toBe("QUOTA_EXCEEDED");
    expect(mapCloudflareHttpError(400, { errors: [{ message: "invalid image_b64" }] }, null).code).toBe("INVALID_IMAGE");
    expect(mapCloudflareHttpError(503, "gateway", null)).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(mapCloudflareEnvelopeError({ success: false, errors: [{ code: 3030, message: "NSFW content detected" }] }).code).toBe("CONTENT_REJECTED");
  });
});

describe("CloudflareAuth", () => {
  it("validates direct-mode inputs and builds the REST endpoint", async () => {
    const auth = makeAuth();
    await expect(auth.saveDirect({ accountId: "nope", apiToken: "x".repeat(40), remember: false })).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    await expect(auth.saveDirect({ accountId: ACCOUNT, apiToken: "short", remember: false })).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    await auth.saveDirect({ accountId: ACCOUNT.toUpperCase(), apiToken: "cf_token_1234567890abcdef", remember: true });
    expect(await auth.getStatus()).toMatchObject({ state: "authenticated", kind: "api_token", label: `012345… · token …cdef` });
    expect(await auth.isRemembered()).toBe(true);
    const ep = await auth.resolveEndpoint("@cf/x/y");
    expect(ep.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/x/y`);
    expect(ep.headers.Authorization).toBe("Bearer cf_token_1234567890abcdef");
    await auth.clear();
    expect((await auth.getStatus()).state).toBe("unauthenticated");
    expect(localStorage.length).toBe(0);
  });

  it("refuses direct mode in a browser but allows worker mode", async () => {
    const auth = makeAuth(false);
    await auth.saveDirect({ accountId: ACCOUNT, apiToken: "cf_token_1234567890abcdef", remember: false });
    await expect(auth.resolveEndpoint("@cf/x/y")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await auth.saveWorker({ workerUrl: "https://aiv.me.workers.dev/", secret: "s3cret-s3cret", remember: false });
    const ep = await auth.resolveEndpoint("@cf/x/y");
    expect(ep).toEqual({ url: "https://aiv.me.workers.dev/run/@cf/x/y", headers: { Authorization: "Bearer s3cret-s3cret" } });
    expect((await auth.getStatus()).label).toBe("aiv.me.workers.dev");
  });

  it("normalizes and rejects bad worker URLs", () => {
    expect(normalizeWorkerUrl(" https://aiv.me.workers.dev/ ")).toBe("https://aiv.me.workers.dev");
    expect(normalizeWorkerUrl("https://example.com/base/")).toBe("https://example.com/base");
    expect(() => normalizeWorkerUrl("http://aiv.me.workers.dev")).toThrow(/https/);
    expect(() => normalizeWorkerUrl("https://user:pw@aiv.me.workers.dev")).toThrow();
    expect(() => normalizeWorkerUrl("not a url")).toThrow();
  });
});

describe("CloudflareProvider", () => {
  async function directProvider() {
    const auth = makeAuth();
    await auth.saveDirect({ accountId: ACCOUNT, apiToken: "cf_token_1234567890abcdef", remember: false });
    const events: unknown[] = [];
    return { provider: new CloudflareProvider(auth, { track: (e) => events.push(e), learnLimit: () => undefined }), auth, events };
  }

  it("posts to the account run endpoint and returns the PNG bytes", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    __setFetchOverride(async (url, init) => {
      calls.push({ url, init });
      return new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } });
    });
    const { provider, events } = await directProvider();
    const result = await provider.generate(
      {
        prompt: "p",
        model: DEFAULT_CLOUDFLARE_MODEL_ID,
        sourceImage: { blob: new Blob([PNG], { type: "image/png" }), mimeType: "image/png", width: 512, height: 512 },
        seed: 42,
      },
      { signal: new AbortController().signal },
    );
    expect(result.mimeType).toBe("image/png");
    expect(result.image.size).toBe(PNG.length);
    expect(result.providerMeta).toMatchObject({ seed: 42, strength: 0.6, steps: 20 });
    expect(calls[0]?.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${DEFAULT_CLOUDFLARE_MODEL_ID}`);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ prompt: "p", width: 512, height: 512, seed: 42 });
    expect(events).toEqual([{ provider: "cloudflare", model: DEFAULT_CLOUDFLARE_MODEL_ID, outcome: "ok" }]);
  });

  it("treats a JSON body on 200 as an envelope error", async () => {
    __setFetchOverride(
      async () =>
        new Response(JSON.stringify({ success: false, errors: [{ code: 3030, message: "NSFW" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { provider } = await directProvider();
    await expect(
      provider.generate(
        { prompt: "p", model: DEFAULT_CLOUDFLARE_MODEL_ID, sourceImage: { blob: new Blob([PNG]), mimeType: "image/png" } },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "CONTENT_REJECTED" });
  });

  it("marks the credential rejected on authentication failures", async () => {
    __setFetchOverride(
      async () => new Response(JSON.stringify({ success: false, errors: [{ code: 9106, message: "Authentication failed (status: 400)" }] }), { status: 400 }),
    );
    const { provider, auth } = await directProvider();
    await expect(
      provider.generate(
        { prompt: "p", model: DEFAULT_CLOUDFLARE_MODEL_ID, sourceImage: { blob: new Blob([PNG]), mimeType: "image/png" } },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    expect((await auth.getStatus()).state).toBe("invalid");
  });

  it("refuses unknown models and missing source images before any request", async () => {
    const fetchSpy = vi.fn();
    __setFetchOverride(fetchSpy);
    const { provider } = await directProvider();
    await expect(provider.generate({ prompt: "p", model: "@cf/unknown" }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
    });
    await expect(provider.generate({ prompt: "p", model: DEFAULT_CLOUDFLARE_MODEL_ID }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates credentials through the model search route in direct mode", async () => {
    const calls: string[] = [];
    __setFetchOverride(async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    });
    const { provider } = await directProvider();
    expect((await provider.validateCredentials()).state).toBe("authenticated");
    expect(calls[0]).toContain(`/accounts/${ACCOUNT}/ai/models/search`);
  });

  it("uses the worker endpoint and health route in worker mode", async () => {
    const calls: string[] = [];
    __setFetchOverride(async (url) => {
      calls.push(url);
      return url.endsWith("/health")
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } });
    });
    const auth = makeAuth(false);
    await auth.saveWorker({ workerUrl: "https://aiv.me.workers.dev", secret: "", remember: false });
    const provider = new CloudflareProvider(auth);
    expect((await provider.validateCredentials()).state).toBe("authenticated");
    await provider.generate(
      { prompt: "p", model: DEFAULT_CLOUDFLARE_MODEL_ID, sourceImage: { blob: new Blob([PNG]), mimeType: "image/png" } },
      { signal: new AbortController().signal },
    );
    expect(calls).toEqual(["https://aiv.me.workers.dev/health", `https://aiv.me.workers.dev/run/${DEFAULT_CLOUDFLARE_MODEL_ID}`]);
  });
});

describe("input preparation for diffusion models", () => {
  const sd15 = CLOUDFLARE_IMAGE_MODELS[0]!;

  it("derives crop/resize/rounding from the model capabilities", () => {
    expect(inputPreparationFor(sd15, { aspectRatio: "original" }, 3072)).toEqual({ maxDimension: 512, multipleOf: 64, format: "image/png" });
    expect(inputPreparationFor(sd15, { aspectRatio: "16:9", imageSize: "1K" }, 3072)).toEqual({
      maxDimension: 1024,
      multipleOf: 64,
      cropToAspectRatio: "16:9",
      format: "image/png",
    });
    expect(inputPreparationFor(sd15, { aspectRatio: "1:1", imageSize: "4K" }, 3072).maxDimension).toBe(1024);
  });

  it("computeGeometry centre-crops, fits and rounds to multiples of 64", () => {
    expect(computeGeometry(1200, 800, { maxDimension: 512, multipleOf: 64 })).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 800, width: 512, height: 320 });
    const g = computeGeometry(1200, 800, { maxDimension: 512, aspectRatio: "1:1", multipleOf: 64 });
    expect(g).toEqual({ sx: 200, sy: 0, sw: 800, sh: 800, width: 512, height: 512 });
    const tall = computeGeometry(600, 1200, { maxDimension: 1024, aspectRatio: "16:9", multipleOf: 64 });
    expect(tall.sw).toBe(600);
    expect(tall.sh).toBe(338);
    expect(tall.width % 64).toBe(0);
    expect(tall.height % 64).toBe(0);
    expect(computeGeometry(100, 100, { maxDimension: 512, multipleOf: 64 })).toMatchObject({ width: 64, height: 64 });
  });
});
