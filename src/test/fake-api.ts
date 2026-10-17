/**
 * An in-memory stand-in for the API, for client tests: listings, images, photo packs, copy runs, credits and settings,
 * answering like the server (same paths, same JSON shapes) through the app's real `ApiClient`. Jobs only move when a
 * test says so (`completeJob`, `failJob`); the SSE stream stays open and empty unless a test pushes events itself.
 */
import { CURRENT_SCHEMA_VERSION, type GenerationErrorCode, type GenerationJob, type ImageAsset, type ListingDocument } from "@aiv/domain/models";
import { createId } from "@aiv/domain/lib/ids";
import { buildShots } from "@aiv/domain/services/catalog";
import { __setServices, createServices } from "@/app/services";
import { createApi } from "@/infrastructure/api/createApi";
import type { FetchLike } from "@/infrastructure/api/ApiClient";
import { LayeredSecretStore, MemorySecretStore } from "@/infrastructure/auth/SecretStore";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import type { StorageProvider } from "@/infrastructure/storage";

const NOW = "2026-10-12T08:00:00.000Z";

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeServer {
  fetch: FetchLike;
  calls: FakeCall[];
  docs: Map<string, ListingDocument>;
  balance: number;
  /** Answers a request before the default routes (return undefined to fall through). */
  override?: (method: string, path: string, body: unknown) => Response | undefined;
  /** A listing as the server would hold it after create + upload. */
  addListing(partial?: Partial<ListingDocument["listing"]>): ListingDocument;
  completeJob(jobId: string): void;
  failJob(jobId: string, code?: GenerationErrorCode): void;
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function asset(listingId: string, kind: ImageAsset["kind"], extra: Partial<ImageAsset> = {}): ImageAsset {
  return { id: createId("img"), listingId, kind, mimeType: "image/png", width: 512, height: 512, byteSize: 3, createdAt: NOW, ...extra };
}

export function createFakeServer(): FakeServer {
  const server: FakeServer = {
    fetch: async () => json(500, {}),
    calls: [],
    docs: new Map(),
    balance: 60,
    addListing(partial = {}) {
      const id = partial.id ?? createId("lst");
      const original = asset(id, "original");
      const doc: ListingDocument = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion: "server",
        listing: { id, name: "Jacket", originalImageId: original.id, coverImageId: original.id, createdAt: NOW, updatedAt: NOW, ...partial },
        images: { [original.id]: original },
        generations: {},
        jobs: {},
        toPost: [],
      };
      server.docs.set(id, doc);
      return structuredClone(doc);
    },
    completeJob(jobId) {
      for (const doc of server.docs.values()) {
        const job = doc.jobs[jobId];
        if (!job) continue;
        const result = asset(doc.listing.id, "generation", { generationId: job.generationId, jobId });
        doc.images[result.id] = result;
        Object.assign(job, { status: "completed", resultImageId: result.id, completedAt: NOW });
        const gen = doc.generations[job.generationId];
        if (gen && gen.jobIds.every((j) => doc.jobs[j]?.status === "completed")) gen.status = "completed";
      }
    },
    failJob(jobId, code = "PROVIDER_UNAVAILABLE") {
      for (const doc of server.docs.values()) {
        const job = doc.jobs[jobId];
        if (job) Object.assign(job, { status: "failed", error: { code, message: "Failed.", retryable: false }, completedAt: NOW });
      }
    },
  };

  const listingRoute = /^\/api\/v1\/listings\/([^/]+)$/;
  server.fetch = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    server.calls.push({ method, path, body });
    const custom = server.override?.(method, path, body);
    if (custom) return custom;

    if (path === "/api/v1/events") return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
    if (path === "/api/v1/me") return json(200, { id: "user-1", email: "seller@example.test", emailVerified: true, name: "" });
    if (path === "/api/v1/me/settings")
      return json(200, method === "PUT" ? body : { locale: "en", theme: "system", vintedAutomationAcknowledged: false, defaultAspectRatio: "original" });
    if (path === "/api/v1/credits") return json(200, { balance: server.balance, plan: "free", ledger: [] });
    if (path === "/api/v1/platform")
      return json(200, { runCost: { image: 1, copy: 1 }, freeMonthlyCredits: 60, imageModel: { aspectRatios: ["original", "1:1"], options: [] } });
    if (path === "/api/v1/listings" && method === "GET")
      return json(
        200,
        [...server.docs.values()].map((d) => ({
          id: d.listing.id,
          name: d.listing.name,
          coverImageId: d.listing.coverImageId,
          imageCount: 0,
          updatedAt: d.listing.updatedAt,
        })),
      );
    if (path === "/api/v1/listings" && method === "POST") {
      const doc = server.addListing({ name: (body as { name?: string }).name ?? "Untitled listing" });
      return json(201, doc);
    }
    const listingMatch = listingRoute.exec(path);
    if (listingMatch) {
      const doc = server.docs.get(listingMatch[1]!);
      if (!doc) return json(404, { code: "NOT_FOUND", message: "Listing not found." });
      if (method === "GET") return json(200, doc);
      if (method === "DELETE") return (server.docs.delete(doc.listing.id), new Response(null, { status: 204 }));
      if (method === "PATCH") {
        const patch = body as Record<string, unknown>;
        for (const [key, value] of Object.entries(patch)) {
          if (key === "toPost") doc.toPost = value as string[];
          else if (value === null) delete (doc.listing as unknown as Record<string, unknown>)[key];
          else (doc.listing as unknown as Record<string, unknown>)[key] = value;
        }
        return json(200, doc);
      }
    }
    const images = /^\/api\/v1\/listings\/([^/]+)\/images$/.exec(path);
    if (images && method === "POST") {
      const doc = server.docs.get(images[1]!)!;
      return json(201, doc.images[doc.listing.originalImageId!]);
    }
    const generations = /^\/api\/v1\/listings\/([^/]+)\/generations$/.exec(path);
    if (generations && method === "POST") {
      const doc = server.docs.get(generations[1]!);
      if (!doc?.listing.category) return json(400, { code: "VALIDATION_FAILED", message: "Choose a category first." });
      const input = body as { shotIds?: string[]; sourceImageId?: string; aspectRatio?: GenerationJob["aspectRatio"] };
      const shots = buildShots(doc.listing.category).filter((s) => !input.shotIds || input.shotIds.includes(s.id));
      if (server.balance < shots.length) return json(402, { code: "INSUFFICIENT_CREDITS", message: "Not enough credits." });
      server.balance -= shots.length;
      const generationId = createId("gen");
      const jobs = shots.map<GenerationJob>((shot, i) => ({
        id: createId("job"),
        listingId: doc.listing.id,
        generationId,
        sourceImageId: input.sourceImageId ?? doc.listing.originalImageId!,
        index: i + 1,
        prompt: shot.prompt,
        shotId: shot.id,
        shotLabel: shot.label,
        provider: "mock",
        model: "mock-image",
        aspectRatio: input.aspectRatio ?? "original",
        status: "queued",
        attempt: 0,
        createdAt: NOW,
      }));
      for (const job of jobs) doc.jobs[job.id] = job;
      doc.generations[generationId] = {
        id: generationId,
        listingId: doc.listing.id,
        sourceImageId: jobs[0]!.sourceImageId,
        prompt: "",
        category: doc.listing.category,
        settings: { providerId: "mock", modelId: "mock-image", aspectRatio: input.aspectRatio ?? "original", variationCount: jobs.length },
        status: "active",
        jobIds: jobs.map((j) => j.id),
        createdAt: NOW,
      };
      return json(202, { generationId, kind: "images", jobIds: jobs.map((j) => j.id), credits: jobs.length });
    }
    if (/^\/api\/v1\/listings\/[^/]+\/copy$/.test(path) && method === "POST") {
      server.balance -= 1;
      return json(202, { generationId: createId("gen"), kind: "copy", jobIds: [createId("job")], credits: 1 });
    }
    const cancel = /^\/api\/v1\/jobs\/([^/]+)\/cancel$/.exec(path);
    if (cancel) {
      for (const doc of server.docs.values()) {
        const job = doc.jobs[cancel[1]!];
        if (job) job.status = "cancelled";
      }
      return json(200, { status: "cancelled" });
    }
    const deletePack = /^\/api\/v1\/generations\/([^/]+)$/.exec(path);
    if (deletePack && method === "DELETE") {
      for (const doc of server.docs.values()) {
        const gen = doc.generations[deletePack[1]!];
        if (!gen) continue;
        for (const id of gen.jobIds) {
          const result = doc.jobs[id]?.resultImageId;
          if (result) delete doc.images[result];
          delete doc.jobs[id];
        }
        delete doc.generations[gen.id];
        return new Response(null, { status: 204 });
      }
      return json(404, { code: "NOT_FOUND", message: "Photo pack not found." });
    }
    const image = /^\/api\/v1\/images\/([^/?]+)/.exec(path);
    if (image) {
      if (method === "DELETE") {
        for (const doc of server.docs.values()) delete doc.images[image[1]!];
        return new Response(null, { status: 204 });
      }
      return new Response(new Uint8Array([137, 80, 78]), { status: 200, headers: { "content-type": "image/png" } });
    }
    return json(404, { code: "NOT_FOUND", message: `No fake route for ${method} ${path}.` });
  };
  return server;
}

/** The app's services on a fake API (and a fresh fake-indexeddb storage for the device's settings and the import). */
export async function useFakeServices(options: { server?: FakeServer; storage?: StorageProvider; tauri?: boolean } = {}) {
  const server = options.server ?? createFakeServer();
  const storage = options.storage ?? new IndexedDbStorage(`test-${Math.random().toString(36).slice(2)}`);
  __setServices(null);
  const api = createApi("/", new LayeredSecretStore(new MemorySecretStore(), null), {
    tauri: options.tauri ?? false,
    fetch: (input, init) => server.fetch(input, init),
  });
  const services = createServices({ storage, api });
  await storage.init();
  return { server, services, storage };
}

/** Just the API side, for tests that build their own services container (`createServices({ storage, api })`). */
export function createFakeApi(server: FakeServer = createFakeServer()) {
  const api = createApi("/", new LayeredSecretStore(new MemorySecretStore(), null), { tauri: false, fetch: (input, init) => server.fetch(input, init) });
  return { server, api };
}
