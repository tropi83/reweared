import { describe, expect, it } from "vitest";
import { AppError, type ListingDocument } from "@aiv/domain/models";
import { ApiClient, type FetchLike } from "@/infrastructure/api/ApiClient";
import { listingPatch, RemoteListingRepository } from "./remote-listing-repository";

const LST = "lst_0123456789abcdef";
const IMG = "img_0123456789abcdef";
const NOW = "2026-10-12T08:00:00.000Z";

function doc(overrides: Partial<ListingDocument["listing"]> = {}, toPost: string[] = []): ListingDocument {
  return {
    schemaVersion: 1,
    appVersion: "server",
    listing: { id: LST, name: "Jacket", originalImageId: IMG, coverImageId: IMG, createdAt: NOW, updatedAt: NOW, ...overrides },
    images: {
      [IMG]: {
        id: IMG,
        listingId: LST,
        kind: "original",
        mimeType: "image/jpeg",
        width: 800,
        height: 600,
        byteSize: 1000,
        createdAt: NOW,
        fileName: "jacket.jpg",
      },
    },
    generations: {},
    jobs: {},
    toPost,
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeServer(routes: (method: string, path: string, body: unknown) => Response | undefined) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : init?.body;
    calls.push({ method, path: url, body });
    return routes(method, url, body) ?? json(404, { code: "NOT_FOUND", message: "Not found." });
  };
  return { calls, repo: new RemoteListingRepository(new ApiClient({ origin: "/", fetch, bearer: async () => null })) };
}

describe("listingPatch", () => {
  it("sends the changed fields only, null for a cleared one", () => {
    const saved = doc({ brand: "Levi's" });
    const before = { listing: { name: "Jacket", brand: "Levi's", coverImageId: IMG }, toPost: [] };
    expect(listingPatch(before, saved)).toEqual({});
    expect(listingPatch(before, doc({ name: " Denim jacket ", useMannequin: true }))).toEqual({ name: "Denim jacket", brand: null, useMannequin: true });
    expect(listingPatch(before, doc({ brand: "Levi's" }, [IMG]))).toEqual({ toPost: [IMG] });
    // An emptied name is never sent (the server refuses it and the store does not allow it).
    expect(listingPatch(before, doc({ name: "  ", brand: "Levi's" }))).toEqual({});
  });
});

describe("RemoteListingRepository", () => {
  it("creates the listing, uploads its photo, then reads the document", async () => {
    const { calls, repo } = fakeServer((method, path) => {
      if (method === "POST" && path === "/api/v1/listings")
        return json(201, { ...doc(), listing: { ...doc().listing, originalImageId: undefined, coverImageId: undefined }, images: {} });
      if (method === "POST" && path === `/api/v1/listings/${LST}/images`) return json(201, doc().images[IMG]);
      if (method === "GET" && path === `/api/v1/listings/${LST}`) return json(200, doc());
      if (method === "PATCH") return json(200, doc());
      return undefined;
    });
    const created = await repo.create("Jacket", {
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
      fileName: "jacket.jpg",
    });
    expect(created.listing.originalImageId).toBe(IMG);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/v1/listings", `POST /api/v1/listings/${LST}/images`, `GET /api/v1/listings/${LST}`]);
    const form = calls[1]?.body as FormData;
    expect((form.get("file") as File).name).toBe("jacket.jpg");

    // The snapshot taken at load: an unchanged document sends nothing, an edit sends that field.
    await repo.save(created);
    await repo.save({ ...created, listing: { ...created.listing, brand: "Levi's" } });
    expect(calls.slice(3).map((c) => [c.method, c.body])).toEqual([["PATCH", { brand: "Levi's" }]]);
  });

  it("removes the empty listing when the photo is refused, and reports the error in the app's words", async () => {
    const { calls, repo } = fakeServer((method, path) => {
      if (method === "POST" && path === "/api/v1/listings") return json(201, { ...doc(), images: {} });
      if (method === "POST") return json(413, { code: "PAYLOAD_TOO_LARGE", message: "The image is too large." });
      if (method === "DELETE") return new Response(null, { status: 204 });
      return undefined;
    });
    const failure = await repo.create("Jacket", { blob: new Blob([new Uint8Array([1])]), mimeType: "image/png" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: "INVALID_IMAGE", detail: "TOO_LARGE" });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: `/api/v1/listings/${LST}` });
  });

  it("reads thumbnails and full images from /images, and answers null for a missing one", async () => {
    const { calls, repo } = fakeServer((_method, path) =>
      path.startsWith(`/api/v1/images/${IMG}`)
        ? new Response(new Blob([new Uint8Array([9])]), { status: 200, headers: { "content-type": "image/webp" } })
        : undefined,
    );
    expect(await repo.readImage(LST, "thumbnail", IMG)).toBeInstanceOf(Blob);
    expect(await repo.readImage(LST, "original", IMG)).toBeInstanceOf(Blob);
    expect(await repo.readImage(LST, "generation", "img_ffffffffffffffff")).toBeNull();
    expect(calls.map((c) => c.path)).toEqual([
      `/api/v1/images/${IMG}?variant=thumb`,
      `/api/v1/images/${IMG}?variant=full`,
      "/api/v1/images/img_ffffffffffffffff?variant=full",
    ]);
    expect(await repo.get(LST)).toBeNull();
  });

  it("refuses to store generated images: the server writes them", async () => {
    const { repo } = fakeServer(() => undefined);
    await expect(repo.storeGeneratedImage()).rejects.toMatchObject({ code: "PLATFORM_UNSUPPORTED" });
  });
});
