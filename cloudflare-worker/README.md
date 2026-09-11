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

| Route               | Purpose                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /health`       | credential check used by _Test connection_                                                                  |
| `GET /models`       | image models your account is allowed to run (`env.AI.models()`), used to grey out private/restricted models |
| `POST /run/<model>` | same JSON body as the Workers AI REST API; answers with PNG bytes                                           |

Allowed models: `@cf/black-forest-labs/flux-2-klein-4b`, `@cf/black-forest-labs/flux-2-klein-9b` (multipart: `prompt`, `input_image_0..3`, `width`, `height`, `seed`, `guidance`) and `@cf/runwayml/stable-diffusion-v1-5-img2img` (JSON). Inputs are validated (prompt length, sizes 256–1920 / 256–2048, `num_steps` ≤ 20, `strength` 0–1, reference images PNG/JPEG under 4 MB) and bodies are capped at 12 MB.

## Costs

Workers AI includes 10,000 neurons per day at no charge. FLUX.2 [klein] 4B costs ≈110 neurons per 1K image (about 90 images/day free); Stable Diffusion 1.5 img2img is $0 per step while in beta but restricted on many accounts. The Workers free plan includes 100,000 requests/day. Cloudflare may change any of this; check your dashboard.
