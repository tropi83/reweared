// End-to-end smoke test against a running stack (compose.dev.yaml): sign up, verify the email through Mailpit,
// create a listing, upload a photo, read its thumbnail, then delete the account through the emailed link.
// Usage: node scripts/server-smoke.mjs [baseUrl=http://localhost:8080] [mailpitUrl=http://localhost:8025]
// Prints each step; exits non-zero on the first failure. Nothing secret is printed.
import { crc32, deflateSync } from "node:zlib";

const base = process.argv[2] ?? "http://localhost:8080";
const mailpit = process.argv[3] ?? "http://localhost:8025";
const email = `smoke+${Date.now().toString(36)}@example.test`;
const password = "smoke test password 1";
const jar = new Map();

function fail(step, detail) {
  console.error(`✗ ${step}: ${detail}`);
  process.exit(1);
}

function remember(response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === "" || /max-age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
}

async function call(step, path, { method = "GET", json, body, headers = {}, expect = 200 } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: "manual",
    headers: {
      origin: base,
      ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      ...(json ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : body,
  });
  remember(response);
  const expected = Array.isArray(expect) ? expect : [expect];
  if (!expected.includes(response.status)) fail(step, `HTTP ${response.status} (expected ${expected.join(" or ")})`);
  console.log(`✓ ${step}`);
  return response;
}

/** The link of the newest email to `to` matching `pathPart`, waiting up to 15 s for it to arrive. */
async function mailedLink(step, pathPart) {
  for (let i = 0; i < 30; i++) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then((r) => r.json());
    for (const message of search.messages ?? []) {
      const full = await fetch(`${mailpit}/api/v1/message/${message.ID}`).then((r) => r.json());
      const link = (full.Text ?? "").match(/https?:\/\/\S+/)?.[0];
      if (link?.includes(pathPart)) {
        const url = new URL(link);
        return `${url.pathname}${url.search}`;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return fail(step, "no email arrived");
}

/** A 64×64 RGB PNG built by hand (no image library needed). */
function png() {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])) >>> 0, 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0);
  header.writeUInt32BE(64, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc(64 * (1 + 64 * 3));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) rows.set([x * 4, y * 4, 160], y * 193 + 1 + x * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await call("api ready", "/api/v1/ready");
await call("sign up", "/api/auth/sign-up/email", { method: "POST", json: { email, password, name: "Smoke" } });
await call("verify email from the mailed link", await mailedLink("verification email", "/verify-email"), { expect: [200, 302] });
await call("sign in", "/api/auth/sign-in/email", { method: "POST", json: { email, password } });
const me = await (await call("me", "/api/v1/me")).json();
if (me.email !== email || !me.emailVerified) fail("me", "unexpected account");

const listing = await (await call("create listing", "/api/v1/listings", { method: "POST", json: { name: "Smoke listing" }, expect: 201 })).json();
const form = new FormData();
form.append("file", new Blob([png()], { type: "image/png" }), "smoke.png");
const image = await (await call("upload photo", `/api/v1/listings/${listing.listing.id}/images`, { method: "POST", body: form, expect: 201 })).json();
const thumb = await call("read thumbnail", `/api/v1/images/${image.id}?variant=thumb`);
if (thumb.headers.get("content-type") !== "image/webp") fail("read thumbnail", `content-type ${thumb.headers.get("content-type")}`);
const document = await (await call("read listing", `/api/v1/listings/${listing.listing.id}`)).json();
if (document.listing.originalImageId !== image.id) fail("read listing", "the upload is not the listing's original");

// --- Generation through the worker (Mock providers in dev/CI), followed live over SSE through Caddy.
const credits = await (await call("free monthly credits", "/api/v1/credits")).json();
if (credits.balance <= 0) fail("free monthly credits", "no credits granted");
await call("set the category", `/api/v1/listings/${listing.listing.id}`, {
  method: "PATCH",
  json: { category: { categoryId: "women", subcategoryId: "clothing" } },
});

const sse = new AbortController();
const stream = await fetch(new URL("/api/v1/events", base), { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, signal: sse.signal });
if (stream.status !== 200 || !stream.headers.get("content-type")?.includes("text/event-stream")) fail("open the event stream", `HTTP ${stream.status}`);
console.log("✓ open the event stream");
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buffered = "";
// Wait for the stream to be live before starting the run, so no event can be missed.
while (!buffered.includes("retry:")) buffered += decoder.decode((await reader.read()).value, { stream: true });

const run = await (
  await call("start a 2-photo run", `/api/v1/listings/${listing.listing.id}/generations`, {
    method: "POST",
    json: { shotIds: ["retouch", "studio"] },
    expect: 202,
  })
).json();
const pending = new Set(run.jobIds);
const deadline = Date.now() + 60_000;
while (pending.size > 0) {
  if (Date.now() > deadline) fail("jobs completed (SSE)", `still waiting for ${pending.size} job(s)`);
  const { value, done } = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve({ value: undefined, done: false }), 1000))]);
  if (done) fail("jobs completed (SSE)", "the stream ended");
  if (value) buffered += decoder.decode(value, { stream: true });
  let end;
  while ((end = buffered.indexOf("\n\n")) >= 0) {
    const block = buffered.slice(0, end);
    buffered = buffered.slice(end + 2);
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (!data) continue;
    const event = JSON.parse(data);
    if (event.type === "job" && pending.has(event.jobId)) {
      if (event.status === "failed") fail("jobs completed (SSE)", `job failed: ${event.error?.code}`);
      if (event.status === "completed") pending.delete(event.jobId);
    }
  }
}
sse.abort();
console.log("✓ jobs completed (SSE)");
const generated = await (await call("read the generations", `/api/v1/listings/${listing.listing.id}`)).json();
const resultId = generated.jobs[run.jobIds[0]]?.resultImageId;
if (!resultId) fail("read the generations", "no result image");
const result = await call("download a generated photo", `/api/v1/images/${resultId}`);
if (!["image/png", "image/jpeg", "image/webp"].includes(result.headers.get("content-type"))) fail("download a generated photo", "not an image");
const after = await (await call("credits after the run", "/api/v1/credits")).json();
if (after.balance !== credits.balance - 2) fail("credits after the run", `expected ${credits.balance - 2}, got ${after.balance}`);

await call("write title and description", `/api/v1/listings/${listing.listing.id}/copy`, { method: "POST", json: { language: "en" }, expect: 202 });
let named = false;
for (let i = 0; i < 60 && !named; i++) {
  const doc = await (
    await fetch(new URL(`/api/v1/listings/${listing.listing.id}`, base), { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } })
  ).json();
  named = Boolean(doc.listing.copy?.title) && doc.listing.name === doc.listing.copy.title;
  if (!named) await new Promise((r) => setTimeout(r, 500));
}
if (!named) fail("title written and listing renamed", "no copy after 30 s");
console.log("✓ title written and listing renamed");

await call("ask to delete the account", "/api/auth/delete-user", { method: "POST", json: {} });
await call("confirm deletion from the mailed link", await mailedLink("deletion email", "/delete-user/callback"), { expect: [200, 302] });
jar.clear();
await call("account gone", "/api/auth/sign-in/email", { method: "POST", json: { email, password }, expect: 401 });
console.log("smoke test passed");
