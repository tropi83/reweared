import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GenerationJob, ListingDocument } from "@aiv/domain/models";
import { ApiClient, type FetchLike } from "@/infrastructure/api/ApiClient";
import { createApi } from "@/infrastructure/api/createApi";
import { LayeredSecretStore, MemorySecretStore } from "@/infrastructure/auth/SecretStore";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { onEvent, stopLiveUpdates } from "./live-updates";
import { RemoteRunEngine, type RunEvent } from "./ports/remote-run-engine";
import { __setServices, createServices } from "./services";
import { applyJobUpdate, buildRequestForJob, persistJobResult, useGenerationStore } from "./stores/generation-store";
import { useListingSetupStore } from "./stores/listing-setup-store";
import { useListingsStore } from "./stores/listings-store";

const LST = "lst_0123456789abcdef";
const IMG = "img_0123456789abcdef";
const GEN = "gen_0123456789abcdef";
const JOB = "job_0123456789abcdef";
const COPY_JOB = "job_fedcba9876543210";
const NOW = "2026-10-12T08:00:00.000Z";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(predicate()).toBe(true);
};

function job(status: GenerationJob["status"]): GenerationJob {
  return {
    id: JOB,
    listingId: LST,
    generationId: GEN,
    sourceImageId: IMG,
    index: 1,
    prompt: "front",
    shotId: "front",
    provider: "mock",
    model: "mock-image",
    aspectRatio: "original",
    status,
    attempt: 1,
    createdAt: NOW,
  };
}

/** The server's document: the listing, plus the pack once started. */
function serverDoc(state: { started: boolean; jobStatus: GenerationJob["status"]; title?: string }): ListingDocument {
  return {
    schemaVersion: 1,
    appVersion: "server",
    listing: {
      id: LST,
      name: state.title ?? "Jacket",
      originalImageId: IMG,
      coverImageId: IMG,
      category: { categoryId: "women", subcategoryId: "jackets-coats" },
      ...(state.title
        ? { copy: { title: state.title, description: "", keywords: [], language: "en", generatedAt: NOW, provider: "mock", model: "mock-copy" } }
        : {}),
      createdAt: NOW,
      updatedAt: NOW,
    },
    images: { [IMG]: { id: IMG, listingId: LST, kind: "original", mimeType: "image/jpeg", width: 800, height: 600, byteSize: 1000, createdAt: NOW } },
    generations: state.started
      ? {
          [GEN]: {
            id: GEN,
            listingId: LST,
            sourceImageId: IMG,
            prompt: "",
            settings: { providerId: "mock", modelId: "mock-image", aspectRatio: "original", variationCount: 1 },
            status: state.jobStatus === "completed" ? "completed" : "active",
            jobIds: [JOB],
            createdAt: NOW,
          },
        }
      : {},
    jobs: state.started ? { [JOB]: job(state.jobStatus) } : {},
    toPost: [],
  };
}

interface Server {
  calls: string[];
  state: { started: boolean; jobStatus: GenerationJob["status"]; title?: string };
  startAnswer: () => Response;
}

function setup(): Server {
  const server: Server = {
    calls: [],
    state: { started: false, jobStatus: "queued" },
    startAnswer: () => ((server.state.started = true), json(202, { generationId: GEN, kind: "images", jobIds: [JOB], credits: 1 })),
  };
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    server.calls.push(`${method} ${url}`);
    if (url === "/api/v1/events") return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
    if (method === "GET" && url === `/api/v1/listings/${LST}`) return json(200, serverDoc(server.state));
    if (method === "PATCH") return json(200, serverDoc(server.state));
    if (method === "POST" && url === `/api/v1/listings/${LST}/generations`) return server.startAnswer();
    if (method === "POST" && url === `/api/v1/listings/${LST}/copy`)
      return json(202, { generationId: "gen_aaaaaaaaaaaaaaaa", kind: "copy", jobIds: [COPY_JOB], credits: 1 });
    if (method === "POST" && url.endsWith("/cancel")) return json(200, { status: "cancelling" });
    if (method === "DELETE" && url === `/api/v1/generations/${GEN}`) {
      server.state.started = false;
      return new Response(null, { status: 204 });
    }
    return json(404, { code: "NOT_FOUND", message: "Not found." });
  };
  __setServices(null);
  const api = createApi("/", new LayeredSecretStore(new MemorySecretStore(), null), { tauri: false, fetch });
  createServices({
    buildRequest: buildRequestForJob,
    persistResult: persistJobResult,
    onJobUpdate: applyJobUpdate,
    storage: new IndexedDbStorage("runs-test"),
    api,
  });
  return server;
}

const jobEvent = (jobId: string, status: string, extra: Partial<Extract<RunEvent, { type: "job" }>> = {}): RunEvent => ({
  type: "job",
  jobId,
  generationId: GEN,
  listingId: LST,
  status,
  attempt: 1,
  ...extra,
});

beforeEach(() => {
  useListingsStore.setState({ current: null, summaries: [] });
  useListingSetupStore.setState({ copyBusy: false, copyError: null, creating: false, lastRun: null });
});
afterEach(() => stopLiveUpdates());

describe("photo packs on the server (API mode)", () => {
  it("starts the pack, then follows it through events that re-read the listing", async () => {
    const server = setup();
    await useListingsStore.getState().open(LST);
    server.state.title = undefined;

    const run = useListingSetupStore.getState().generateListing();
    // The copy part waits for its job's event; the photo part is already started.
    await until(() => server.calls.includes(`POST /api/v1/listings/${LST}/generations`) && server.calls.includes(`POST /api/v1/listings/${LST}/copy`));
    await until(() => useListingsStore.getState().current?.jobs[JOB]?.status === "queued");

    server.state.jobStatus = "completed";
    onEvent(jobEvent(JOB, "completed", { resultImageId: IMG }));
    await until(() => useListingsStore.getState().current?.jobs[JOB]?.status === "completed");

    server.state.title = "Denim jacket";
    onEvent(jobEvent(COPY_JOB, "completed"));
    const report = await run;
    expect(report).toEqual({ photos: "done", text: "done" });
    expect(useListingsStore.getState().current?.listing).toMatchObject({ name: "Denim jacket", copy: { title: "Denim jacket" } });
    expect(useListingSetupStore.getState().copyBusy).toBe(false);
  });

  it("reports missing credits and the platform's daily limit in the run's outcome", async () => {
    const server = setup();
    await useListingsStore.getState().open(LST);
    server.startAnswer = () => json(402, { code: "INSUFFICIENT_CREDITS", message: "Not enough credits." });
    const pending = useListingSetupStore.getState().generateListing();
    await until(() => server.calls.includes(`POST /api/v1/listings/${LST}/copy`));
    onEvent(jobEvent(COPY_JOB, "failed", { error: { code: "PROVIDER_UNAVAILABLE", message: "Down." } }));
    const report = await pending;
    expect(report?.photos).toMatchObject({ error: { code: "QUOTA_EXCEEDED", detail: "INSUFFICIENT_CREDITS" } });
    expect(report?.text).toMatchObject({ error: { code: "PROVIDER_UNAVAILABLE" } });

    server.startAnswer = () => json(503, { code: "PROVIDER_BUDGET_EXHAUSTED", message: "Try again tomorrow." });
    const again = useListingSetupStore.getState().generateListing();
    await until(() => server.calls.filter((c) => c.endsWith("/copy")).length === 2);
    useListingSetupStore.getState().cancelCopy();
    expect((await again)?.photos).toMatchObject({ error: { code: "PROVIDER_BUDGET_EXHAUSTED" } });
  });

  it("cancels the open listing's active jobs on the server", async () => {
    const server = setup();
    server.state = { started: true, jobStatus: "generating" };
    await useListingsStore.getState().open(LST);
    useGenerationStore.getState().cancelAll();
    await until(() => server.calls.includes(`POST /api/v1/jobs/${JOB}/cancel`));
  });
});

describe("deleting a pack (API mode)", () => {
  it("asks the server to delete it, then shows the listing without it", async () => {
    const server = setup();
    server.state = { started: true, jobStatus: "completed" };
    await useListingsStore.getState().open(LST);
    expect(useListingsStore.getState().current?.generations[GEN]).toBeDefined();
    await useListingsStore.getState().deleteGeneration(GEN);
    expect(server.calls).toContain(`DELETE /api/v1/generations/${GEN}`);
    // Not image by image: the server removes the pack's photos itself.
    expect(server.calls.filter((c) => c.startsWith("DELETE /api/v1/images"))).toEqual([]);
    expect(useListingsStore.getState().current?.generations).toEqual({});
  });
});

describe("RemoteRunEngine.watch", () => {
  it("hands over the events it understands and resumes on reconnection", async () => {
    let call = 0;
    const fetch: FetchLike = async () => {
      call++;
      const body =
        call === 1
          ? `id: 1-0\ndata: ${JSON.stringify(jobEvent(JOB, "generating"))}\n\nid: 2-0\ndata: {"type":"unknown"}\n\nid: 3-0\ndata: {"type":"credits","balance":59}\n\n`
          : ": idle\n\n";
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const engine = new RemoteRunEngine(new ApiClient({ origin: "/", fetch, bearer: async () => null }));
    const seen: RunEvent[] = [];
    let opened = 0;
    const stop = engine.watch(
      (e) => seen.push(e),
      () => opened++,
    );
    await until(() => opened >= 2);
    stop();
    expect(seen).toEqual([jobEvent(JOB, "generating"), { type: "credits", balance: 59 }]);
  });
});
