import { beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ListingDocument } from "@aiv/domain/models";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { fitCopy, LocalImport } from "./import-local";
import type { ListingRepository } from "./ports/listing-repository";

const NOW = "2026-10-12T08:00:00.000Z";
const ORIGINAL = "img_00000000000000a1";
const GENERATED = "img_00000000000000b2";

function localDoc(id: string, withOriginal = true): ListingDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: "0.1.0",
    listing: {
      id,
      name: `Jacket ${id.slice(-2)}`,
      ...(withOriginal ? { originalImageId: ORIGINAL, coverImageId: GENERATED } : {}),
      category: { categoryId: "women", subcategoryId: "clothing" },
      brand: "Levi's",
      useMannequin: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
    images: withOriginal
      ? {
          [ORIGINAL]: {
            id: ORIGINAL,
            listingId: id,
            kind: "original",
            mimeType: "image/jpeg",
            width: 10,
            height: 10,
            byteSize: 3,
            fileName: "jacket.jpg",
            createdAt: NOW,
          },
          [GENERATED]: { id: GENERATED, listingId: id, kind: "generation", mimeType: "image/png", width: 10, height: 10, byteSize: 3, createdAt: NOW },
        }
      : {},
    generations: {},
    jobs: {},
    toPost: withOriginal ? [ORIGINAL, GENERATED] : [],
  };
}

/** The account, in memory: what was created and saved. */
function fakeAccount(options: { failSaves?: number } = {}) {
  const docs = new Map<string, ListingDocument>();
  const uploads: Array<{ name: string; fileName?: string }> = [];
  let failSaves = options.failSaves ?? 0;
  let n = 0;
  const repo: Pick<ListingRepository, "create" | "save" | "get"> = {
    async create(name, original) {
      const id = `lst_00000000000000${String(++n).padStart(2, "0")}`;
      const img = `img_00000000000001${String(n).padStart(2, "0")}`;
      uploads.push({ name, ...(original.fileName ? { fileName: original.fileName } : {}) });
      const doc: ListingDocument = {
        ...localDoc(id, false),
        listing: { id, name, originalImageId: img, coverImageId: img, createdAt: NOW, updatedAt: NOW },
        images: { [img]: { id: img, listingId: id, kind: "original", mimeType: original.mimeType, width: 10, height: 10, byteSize: 3, createdAt: NOW } },
      };
      docs.set(id, doc);
      return structuredClone(doc);
    },
    async save(doc) {
      if (failSaves-- > 0) throw new Error("network");
      docs.set(doc.listing.id, structuredClone(doc));
    },
    async get(id) {
      return structuredClone(docs.get(id) ?? null);
    },
  };
  return { docs, uploads, repo: repo as ListingRepository };
}

let storage: IndexedDbStorage;
beforeEach(async () => {
  storage = new IndexedDbStorage(`import-test-${Math.random()}`);
  await storage.init();
  for (const id of ["lst_00000000000000c1", "lst_00000000000000c2"]) {
    await storage.saveListing(localDoc(id));
    await storage.writeImage(id, "original", ORIGINAL, new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }));
  }
  await storage.saveListing(localDoc("lst_00000000000000c3", false));
});

describe("LocalImport", () => {
  it("copies each listing's original and details, not its generated photos, and does not import twice", async () => {
    const account = fakeAccount();
    const importer = new LocalImport(storage, account.repo);
    const pending = await importer.pending();
    expect(pending).toHaveLength(3);
    const results = [];
    for (const listing of pending) results.push(await importer.importOne(listing.id));
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(account.uploads).toEqual([
      { name: expect.stringMatching(/^Jacket/), fileName: "jacket.jpg" },
      { name: expect.stringMatching(/^Jacket/), fileName: "jacket.jpg" },
    ]);
    const [first] = [...account.docs.values()];
    expect(first?.listing).toMatchObject({ brand: "Levi's", useMannequin: true, category: { categoryId: "women", subcategoryId: "clothing" } });
    // "To post" keeps the original (under its new id) and drops the generated photo that was not imported.
    expect(first?.toPost).toEqual([first?.listing.originalImageId]);
    expect(Object.values(first?.images ?? {}).map((i) => i.kind)).toEqual(["original"]);

    expect(await importer.pending()).toEqual([]);
    // The device keeps its listings.
    expect(await storage.listListings()).toHaveLength(3);
  });

  it("finishes a listing whose details failed instead of creating it again", async () => {
    const account = fakeAccount({ failSaves: 1 });
    const importer = new LocalImport(storage, account.repo);
    await expect(importer.importOne("lst_00000000000000c1")).rejects.toThrow();
    expect(await importer.pending()).toHaveLength(3);
    await importer.importOne("lst_00000000000000c1");
    expect(account.uploads).toHaveLength(1);
    expect([...account.docs.values()][0]?.listing.brand).toBe("Levi's");
    expect(await importer.pending()).toHaveLength(2);
  });

  it("fits a copy edited on the device into the server's limits", () => {
    const copy = fitCopy({
      title: "t".repeat(250),
      description: "d",
      keywords: Array.from({ length: 25 }, () => "k".repeat(50)),
      language: "en",
      generatedAt: NOW,
      provider: "gemini",
      model: "m",
    });
    expect(copy.title).toHaveLength(200);
    expect(copy.keywords).toHaveLength(20);
    expect(copy.keywords[0]).toHaveLength(40);
  });
});
