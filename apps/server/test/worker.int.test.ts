import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { creditBalance, creditLedger, generation, generationJob, imageAsset, listing } from "../src/db/schema";
import { MOCK_COPY_MODEL_ID, MOCK_IMAGE_MODEL } from "../src/providers/catalogue";
import { MockCopyProvider, SharpMockImageProvider } from "../src/providers/sharp-mock";
import { RedisEventPublisher, eventStreamKey } from "../src/queue/events";
import { runJob, type RunJobDeps } from "../src/worker/run-job";
import { startWorkers, type RunningWorkers } from "../src/worker/workers";
import { signIn, startHarness, verifiedUser, type Harness } from "./app-harness";

let h: Harness;
let image: SharpMockImageProvider;
let deps: RunJobDeps;
let workers: RunningWorkers | undefined;
const silent = { level: "silent", fatal() {}, error() {}, warn() {}, info() {}, debug() {}, trace() {}, silent() {}, child: () => silent } as never;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  image = new SharpMockImageProvider();
  deps = {
    db: h.database.db,
    redis: h.runs.redis,
    store: h.store,
    providers: { image, copy: new MockCopyProvider() },
    imageProvider: "mock",
    imageModel: MOCK_IMAGE_MODEL,
    copyModelId: MOCK_COPY_MODEL_ID,
    attempts: 3,
    timeoutMs: 5_000,
    dispatcher: h.runs.dispatcher,
    budget: h.runs.budget,
    events: new RedisEventPublisher(h.runs.redis),
    log: silent,
  };
});
afterEach(async () => {
  await workers?.close();
  workers = undefined;
});

const start = async () => {
  workers = await startWorkers(deps, {
    connection: h.runs.redis,
    queues: h.runs.queues,
    copyProvider: "mock",
    concurrency: 4,
    maxPerMinute: { image: 1000, copy: 1000 },
    backoff: { baseMs: 10, maxMs: 50 },
  });
};

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > until) throw new Error(`timed out waiting; last value: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A signed-in user with a listing (women › clothing) and a real uploaded photo. */
async function setup(email = "alice@example.test"): Promise<{ headers: Record<string, string>; userId: string; listingId: string }> {
  await verifiedUser(h, email);
  const res = await signIn(h, email);
  const headers = { authorization: `Bearer ${String(res.headers["set-auth-token"])}` };
  const listingId = (await h.app.inject({ method: "POST", url: "/api/v1/listings", headers, payload: {} })).json().listing.id as string;
  await h.app.inject({
    method: "PATCH",
    url: `/api/v1/listings/${listingId}`,
    headers,
    payload: { category: { categoryId: "women", subcategoryId: "clothing" } },
  });
  const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3366cc" } })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "shirt.jpg");
  const req = new Request("http://form.local", { method: "POST", body: form });
  await h.app.inject({
    method: "POST",
    url: `/api/v1/listings/${listingId}/images`,
    headers: { ...headers, "content-type": req.headers.get("content-type") ?? "" },
    payload: Buffer.from(await req.arrayBuffer()),
  });
  return { headers, userId: res.json().user.id as string, listingId };
}

const startRun = async (u: { headers: Record<string, string>; listingId: string }, shots = 1) => {
  const shotIds = ["retouch", "studio", "worn", "folded", "mirror"].slice(0, shots);
  const res = await h.app.inject({ method: "POST", url: `/api/v1/listings/${u.listingId}/generations`, headers: u.headers, payload: { shotIds } });
  if (res.statusCode !== 202) throw new Error(`start failed: ${res.statusCode} ${res.body}`);
  return res.json() as { generationId: string; jobIds: string[] };
};
const job = async (id: string) => (await h.database.db.select().from(generationJob).where(eq(generationJob.id, id)))[0]!;
const balance = async (userId: string) => (await h.database.db.select().from(creditBalance).where(eq(creditBalance.userId, userId)))[0]?.balance;

describe("worker", () => {
  it("generates the shots, stores the images like uploads and completes the generation", async () => {
    await start();
    const u = await setup();
    const run = await startRun(u, 2);
    const jobs = await waitFor(
      () => Promise.all(run.jobIds.map(job)),
      (rows) => rows.every((r) => r.status === "completed"),
    );
    expect((await h.database.db.select().from(generation).where(eq(generation.id, run.generationId)))[0]?.status).toBe("completed");
    for (const row of jobs) {
      const res = await h.app.inject({ method: "GET", url: `/api/v1/images/${row.resultImageId}?variant=thumb`, headers: u.headers });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/webp");
    }
    const generated = await h.database.db.select().from(imageAsset).where(eq(imageAsset.kind, "generation"));
    expect(generated.map((g) => g.jobId).sort()).toEqual([...run.jobIds].sort());
    expect(await balance(u.userId)).toBe(58);
    const events = await h.runs.redis.xrange(eventStreamKey(u.userId), "-", "+");
    expect(events.some(([, fields]) => fields[1]?.includes('"status":"completed"'))).toBe(true);
    expect(events.every(([, fields]) => !fields[1]?.includes(jobs[0]!.prompt))).toBe(true);
  });

  it("retries a transient failure with a new seed and succeeds", async () => {
    image.scenario = "flaky";
    await start();
    const u = await setup();
    const run = await startRun(u);
    const row = await waitFor(
      () => job(run.jobIds[0]!),
      (r) => r.status === "completed" || r.status === "failed",
    );
    expect(row.status).toBe("completed");
    expect(row.attempt).toBe(2);
    expect(image.seeds).toHaveLength(2);
    expect(image.seeds[0]).not.toBe(image.seeds[1]);
    expect(await balance(u.userId)).toBe(59);
  });

  it("fails at once on a refusal and refunds", async () => {
    image.scenario = "error";
    await start();
    const u = await setup();
    const run = await startRun(u);
    const row = await waitFor(
      () => job(run.jobIds[0]!),
      (r) => r.status === "failed",
    );
    expect(row.error?.code).toBe("CONTENT_REJECTED");
    expect(row.attempt).toBe(1);
    expect(await balance(u.userId)).toBe(60);
  });

  it("gives up after the last attempt on timeouts and refunds exactly once", async () => {
    image.scenario = "timeout";
    deps.timeoutMs = 300;
    await start();
    const u = await setup();
    const run = await startRun(u);
    const row = await waitFor(
      () => job(run.jobIds[0]!),
      (r) => r.status === "failed",
    );
    expect(row.error?.code).toBe("TIMEOUT");
    expect(row.attempt).toBe(3);
    const refunds = await h.database.db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.reason, "refund"), eq(creditLedger.jobId, row.id)));
    expect(refunds).toHaveLength(1);
    expect(await balance(u.userId)).toBe(60);
  });

  it("stops a running job on cancel, keeps nothing and refunds", async () => {
    image.scenario = "slow";
    image.delayMs = 3_000;
    await start();
    const u = await setup();
    const run = await startRun(u);
    await waitFor(
      () => job(run.jobIds[0]!),
      (r) => r.status === "active",
    );
    const res = await h.app.inject({ method: "POST", url: `/api/v1/jobs/${run.jobIds[0]}/cancel`, headers: u.headers });
    expect(res.json()).toEqual({ status: "cancelling" });
    const row = await waitFor(
      () => job(run.jobIds[0]!),
      (r) => r.status === "cancelled",
    );
    expect(row.resultImageId).toBeNull();
    expect(await h.database.db.select().from(imageAsset).where(eq(imageAsset.kind, "generation"))).toEqual([]);
    expect(await balance(u.userId)).toBe(60);
  });

  it("stores one result when the same job is delivered twice", async () => {
    const u = await setup();
    const run = await startRun(u);
    // No workers: deliver the dispatched job twice by hand, concurrently.
    await Promise.all([runJob(deps, { jobId: run.jobIds[0]!, attemptsMade: 0 }), runJob(deps, { jobId: run.jobIds[0]!, attemptsMade: 0 })]);
    expect((await job(run.jobIds[0]!)).status).toBe("completed");
    expect(await h.database.db.select().from(imageAsset).where(eq(imageAsset.kind, "generation"))).toHaveLength(1);
  });

  it("writes the listing copy and names the listing after the title", async () => {
    await start();
    const u = await setup();
    const res = await h.app.inject({ method: "POST", url: `/api/v1/listings/${u.listingId}/copy`, headers: u.headers, payload: { language: "fr" } });
    const jobId = res.json().jobIds[0] as string;
    await waitFor(
      () => job(jobId),
      (r) => r.status === "completed",
    );
    const [row] = await h.database.db.select().from(listing).where(eq(listing.id, u.listingId));
    expect(row?.copy).toMatchObject({ title: "Chemise en coton bleue", language: "fr", provider: "mock", model: MOCK_COPY_MODEL_ID });
    expect(row?.name).toBe("Chemise en coton bleue");
  });
});
