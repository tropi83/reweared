/**
 * Schema v3: "project" became "listing" (the aggregate), and the category selection that used to be called
 * `listing` became `category`. Data saved before the rename must open unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { CURRENT_SCHEMA_VERSION } from "@/domain/models";
import { IndexedDbStorage } from "./IndexedDbStorage";
import { migrateListingDocument } from "./migrations";

const V2_DOC = {
  schemaVersion: 2,
  appVersion: "0.1.0",
  project: {
    id: "prj_11111111",
    name: "Chemise",
    originalImageId: "img_aaaaaaaa",
    listing: { categoryId: "women", subcategoryId: "clothing" },
    brand: "Nike",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  },
  images: {
    img_aaaaaaaa: { id: "img_aaaaaaaa", projectId: "prj_11111111", kind: "original", mimeType: "image/png", width: 1, height: 1, byteSize: 1, createdAt: "" },
  },
  generations: {
    gen_1: {
      id: "gen_1",
      projectId: "prj_11111111",
      sourceImageId: "img_aaaaaaaa",
      prompt: "pack",
      listing: { categoryId: "women", subcategoryId: "clothing" },
      settings: { providerId: "mock", modelId: "m", aspectRatio: "original", variationCount: 1 },
      status: "completed",
      jobIds: ["job_1"],
      createdAt: "",
    },
  },
  jobs: { job_1: { id: "job_1", projectId: "prj_11111111", generationId: "gen_1", index: 0, prompt: "p", status: "completed", attempts: 1, createdAt: "" } },
  toPost: ["img_aaaaaaaa"],
};

describe("schema v3 (project → listing)", () => {
  it("migrates a v2 document: listing aggregate, category selection, listingId everywhere", () => {
    const doc = migrateListingDocument(structuredClone(V2_DOC));
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect("project" in doc).toBe(false);
    expect(doc.listing.id).toBe("prj_11111111");
    expect(doc.listing.name).toBe("Chemise");
    expect(doc.listing.brand).toBe("Nike");
    expect(doc.listing.category).toEqual({ categoryId: "women", subcategoryId: "clothing" });
    expect("listing" in doc.listing).toBe(false);
    expect(doc.images.img_aaaaaaaa?.listingId).toBe("prj_11111111");
    expect("projectId" in doc.images.img_aaaaaaaa!).toBe(false);
    expect(doc.generations.gen_1?.listingId).toBe("prj_11111111");
    expect(doc.generations.gen_1?.category).toEqual({ categoryId: "women", subcategoryId: "clothing" });
    expect("listing" in doc.generations.gen_1!).toBe(false);
    expect(doc.jobs.job_1?.listingId).toBe("prj_11111111");
    expect(doc.toPost).toEqual(["img_aaaaaaaa"]);
    expect(migrateListingDocument(structuredClone(doc))).toEqual(doc);
  });

  it("still upgrades a v0 document all the way", () => {
    const doc = migrateListingDocument({ project: { id: "prj_0" }, images: {}, generations: {}, jobs: {} });
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.listing.id).toBe("prj_0");
    expect(doc.toPost).toEqual([]);
  });

  it("IndexedDB v1 databases are upgraded: the 'projects' store becomes 'listings' with its records", async () => {
    const name = "rename-upgrade-test";
    // A database exactly as version 1 of the app created it, with one v2 document inside.
    const legacy = await openDB(name, 1, {
      upgrade(db) {
        const projects = db.createObjectStore("projects", { keyPath: "project.id" });
        projects.createIndex("updatedAt", "project.updatedAt");
        const images = db.createObjectStore("images", { keyPath: "key" });
        images.createIndex("projectId", "projectId");
        db.createObjectStore("settings");
        db.createObjectStore("recipes", { keyPath: "id" });
      },
    });
    await legacy.put("projects", structuredClone(V2_DOC));
    await legacy.put("images", {
      key: "prj_11111111/original/img_aaaaaaaa",
      projectId: "prj_11111111",
      bucket: "original",
      assetId: "img_aaaaaaaa",
      bytes: new Uint8Array([1, 2, 3]).buffer,
      type: "image/png",
      size: 3,
    });
    legacy.close();

    const storage = new IndexedDbStorage(name);
    await storage.init();
    const list = await storage.listListings();
    expect(list.map((l) => l.id)).toEqual(["prj_11111111"]);
    const doc = await storage.getListing("prj_11111111");
    expect(doc?.listing.category).toEqual({ categoryId: "women", subcategoryId: "clothing" });
    expect(doc?.jobs.job_1?.listingId).toBe("prj_11111111");
    const blob = await storage.readImage("prj_11111111", "original", "img_aaaaaaaa");
    expect(blob && new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    await storage.deleteListing("prj_11111111");
    expect(await storage.readImage("prj_11111111", "original", "img_aaaaaaaa")).toBeNull();
    expect(await storage.listListings()).toEqual([]);
  });
});

/** Minimal in-memory stand-in for @tauri-apps/plugin-fs, just what init() and the migration touch. */
function fakeFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const parent = (p: string) => p.split("/").slice(0, -1).join("/");
  const rename = (from: string, to: string) => {
    for (const d of [...dirs]) {
      if (d === from || d.startsWith(`${from}/`)) {
        dirs.delete(d);
        dirs.add(to + d.slice(from.length));
      }
    }
    for (const [f, v] of [...files]) {
      if (f === from || f.startsWith(`${from}/`)) {
        files.delete(f);
        files.set(to + f.slice(from.length), v);
      }
    }
  };
  const api = {
    BaseDirectory: { AppData: 1 },
    mkdir: async (p: string) => void dirs.add(p),
    exists: async (p: string) => dirs.has(p) || files.has(p),
    readDir: async (p: string) =>
      [...new Set([...[...dirs].filter((d) => parent(d) === p), ...[...files.keys()].filter((f) => parent(f) === p)])].map((child) => ({
        name: child.split("/").pop()!,
        isDirectory: dirs.has(child),
        isFile: files.has(child),
        isSymlink: false,
      })),
    rename: async (from: string, to: string) => rename(from, to),
    readTextFile: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeTextFile: async (p: string, v: string) => void files.set(p, v),
    remove: async (p: string) => {
      files.delete(p);
      dirs.delete(p);
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
      for (const k of [...dirs]) if (k.startsWith(`${p}/`)) dirs.delete(k);
    },
    writeFile: async () => undefined,
    readFile: async () => new Uint8Array(),
    stat: async () => ({ size: 0 }),
  };
  return { api, files, dirs };
}

describe("TauriFsStorage layout migration", () => {
  it("renames projects/<id>/project.json to listings/<id>/listing.json once, and reads the listing back", async () => {
    const fs = fakeFs();
    fs.dirs.add("projects");
    fs.dirs.add("projects/prj_11111111");
    fs.dirs.add("projects/prj_11111111/original");
    fs.files.set("projects/prj_11111111/project.json", JSON.stringify(V2_DOC));
    fs.files.set("projects/prj_11111111/original/img_aaaaaaaa.png", "png");
    vi.doMock("@tauri-apps/plugin-fs", () => fs.api);
    vi.doMock("@tauri-apps/api/path", () => ({ appDataDir: async () => "/appdata" }));
    const { TauriFsStorage } = await import("./TauriFsStorage");

    const storage = new TauriFsStorage();
    await storage.init();
    expect(fs.dirs.has("projects")).toBe(false);
    expect(fs.files.has("listings/prj_11111111/listing.json")).toBe(true);
    expect(fs.files.has("listings/prj_11111111/original/img_aaaaaaaa.png")).toBe(true);
    expect((await storage.listListings()).map((l) => l.name)).toEqual(["Chemise"]);
    expect((await storage.getListing("prj_11111111"))?.listing.category?.categoryId).toBe("women");

    // Idempotent: a second init on the migrated layout changes nothing.
    await new TauriFsStorage().init();
    expect([...fs.files.keys()].sort()).toEqual(["listings/prj_11111111/listing.json", "listings/prj_11111111/original/img_aaaaaaaa.png"]);
    vi.doUnmock("@tauri-apps/plugin-fs");
    vi.doUnmock("@tauri-apps/api/path");
  });
});
