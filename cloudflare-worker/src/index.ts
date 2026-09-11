/**
 * AI Image Variations — personal Workers AI endpoint.
 *
 * Deploy this Worker in YOUR Cloudflare account. It exposes the Stable Diffusion img2img models
 * to the app through the `AI` binding, so no Cloudflare API token ever exists outside Cloudflare,
 * and it adds the CORS headers api.cloudflare.com lacks so the web build can call it.
 *
 * Routes:
 *   GET  /health          -> { ok: true }
 *   GET  /models          -> { models: [{ name }] } (image models this account can run)
 *   POST /run/<model id>  -> PNG bytes (same body as the Workers AI REST API)
 *
 * Security:
 *   - Only the models listed in ALLOWED_MODELS can be run.
 *   - Set the WORKER_SECRET secret (`wrangler secret put WORKER_SECRET`) to require
 *     `Authorization: Bearer <secret>`; without it the endpoint is open to anyone who finds the URL.
 *   - ALLOWED_ORIGINS restricts browser callers (comma-separated origins, "*" for any).
 *   - Bodies are capped at 12 MB; inputs are validated against the model schema ranges.
 */

export interface Env {
  AI: Ai;
  WORKER_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

const ALLOWED_MODELS = new Set([
  "@cf/runwayml/stable-diffusion-v1-5-img2img",
  "@cf/lykon/dreamshaper-8-lcm",
  "@cf/stabilityai/stable-diffusion-xl-base-1.0",
  "@cf/bytedance/stable-diffusion-xl-lightning",
]);

const MAX_BODY_BYTES = 12 * 1024 * 1024;

interface RunBody {
  prompt?: unknown;
  negative_prompt?: unknown;
  image_b64?: unknown;
  width?: unknown;
  height?: unknown;
  num_steps?: unknown;
  strength?: unknown;
  guidance?: unknown;
  seed?: unknown;
}

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes("*") ? "*" : origin && allowed.includes(origin) ? origin : "";
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function num(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(env, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      if (!authorized(request, env)) return json(401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] }, cors);
      return json(200, { ok: true }, cors);
    }
    if (request.method === "GET" && url.pathname === "/models") {
      if (!authorized(request, env)) return json(401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] }, cors);
      try {
        const list = (await env.AI.models({ task: "Text-to-Image", per_page: 100 })) as Array<{ name?: string }>;
        return json(200, { models: list.filter((m) => m.name && ALLOWED_MODELS.has(m.name)).map((m) => ({ name: m.name })) }, cors);
      } catch (err) {
        return json(502, { success: false, errors: [{ code: 502, message: err instanceof Error ? err.message : "models() failed" }] }, cors);
      }
    }
    if (request.method !== "POST" || !url.pathname.startsWith("/run/")) {
      return json(404, { success: false, errors: [{ code: 7003, message: "Not found" }] }, cors);
    }
    if (!authorized(request, env)) return json(401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] }, cors);

    const model = decodeURIComponent(url.pathname.slice("/run/".length));
    if (!ALLOWED_MODELS.has(model)) return json(404, { success: false, errors: [{ code: 5007, message: "No such model" }] }, cors);

    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_BODY_BYTES) return json(413, { success: false, errors: [{ code: 413, message: "Body too large" }] }, cors);

    let body: RunBody;
    try {
      body = (await request.json()) as RunBody;
    } catch {
      return json(400, { success: false, errors: [{ code: 400, message: "Invalid JSON body" }] }, cors);
    }
    if (typeof body.prompt !== "string" || body.prompt.trim().length === 0 || body.prompt.length > 2000) {
      return json(400, { success: false, errors: [{ code: 400, message: "prompt is required (1-2000 chars)" }] }, cors);
    }
    if (body.image_b64 !== undefined && (typeof body.image_b64 !== "string" || body.image_b64.length > MAX_BODY_BYTES)) {
      return json(400, { success: false, errors: [{ code: 400, message: "image_b64 must be a base64 string" }] }, cors);
    }

    const inputs: Record<string, unknown> = { prompt: body.prompt.trim() };
    if (typeof body.negative_prompt === "string" && body.negative_prompt.trim()) inputs.negative_prompt = body.negative_prompt.trim().slice(0, 2000);
    if (typeof body.image_b64 === "string") inputs.image_b64 = body.image_b64;
    const width = num(body.width, 256, 2048);
    const height = num(body.height, 256, 2048);
    if (width !== undefined) inputs.width = Math.round(width);
    if (height !== undefined) inputs.height = Math.round(height);
    const steps = num(body.num_steps, 1, 20);
    if (steps !== undefined) inputs.num_steps = Math.round(steps);
    const strength = num(body.strength, 0, 1);
    if (strength !== undefined) inputs.strength = strength;
    const guidance = num(body.guidance, 0, 30);
    if (guidance !== undefined) inputs.guidance = guidance;
    const seed = num(body.seed, 0, 2_147_483_647);
    if (seed !== undefined) inputs.seed = Math.round(seed);

    try {
      // The binding returns the PNG bytes as a ReadableStream for these models.
      const output = (await env.AI.run(model as Parameters<Ai["run"]>[0], inputs as never)) as unknown as ReadableStream | ArrayBuffer | Uint8Array;
      return new Response(output as BodyInit, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "no-store", ...cors } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workers AI error";
      const status = /rate limit|too many/i.test(message) ? 429 : /quota|allocation|neuron/i.test(message) ? 429 : 502;
      return json(status, { success: false, errors: [{ code: status, message }] }, cors);
    }
  },
} satisfies ExportedHandler<Env>;

function authorized(request: Request, env: Env): boolean {
  if (!env.WORKER_SECRET) return true;
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.length > 0 && timingSafeEqual(token, env.WORKER_SECRET);
}
