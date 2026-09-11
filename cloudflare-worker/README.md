# AI Image Variations — personal Workers AI endpoint

A ~100-line Cloudflare Worker you deploy in **your own** Cloudflare account. The app calls it instead of `api.cloudflare.com`, which has no CORS headers and therefore cannot be reached from a browser. The Worker runs the Stable Diffusion img2img models through the `AI` binding, so **no API token exists outside Cloudflare**.

It is not a backend of AI Image Variations: it lives in your account, under your control, and only talks to Cloudflare's own inference.

## Deploy (5 minutes, free plan is enough)

```bash
cd cloudflare-worker
npm install
npx wrangler login                 # opens the Cloudflare dashboard once
npx wrangler secret put WORKER_SECRET   # choose a long random string; optional but recommended
npx wrangler deploy
```

`wrangler deploy` prints the URL, e.g. `https://aiv-workers-ai.<your-subdomain>.workers.dev`. In the app: Settings → Providers → Cloudflare Workers AI → _Your Worker_ → paste the URL and the secret.

Optional: restrict browser callers by editing `ALLOWED_ORIGINS` in `wrangler.toml` (comma-separated origins).

## Routes

| Route               | Purpose                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `GET /health`       | credential check used by _Test connection_                        |
| `POST /run/<model>` | same JSON body as the Workers AI REST API; answers with PNG bytes |

Allowed models: `@cf/runwayml/stable-diffusion-v1-5-img2img`, `@cf/lykon/dreamshaper-8-lcm`, `@cf/stabilityai/stable-diffusion-xl-base-1.0`, `@cf/bytedance/stable-diffusion-xl-lightning`. Bodies are validated (prompt 1–2000 chars, `num_steps` ≤ 20, `strength` 0–1, sizes 256–2048) and capped at 12 MB.

## Costs

The four models are billed at $0 per step while in beta (Workers AI pricing, checked 2026-09-11). The Workers free plan includes 100,000 requests/day. Cloudflare may change either; check your dashboard.
