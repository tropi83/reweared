import { beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, type ProjectDocument } from "@/domain/models";
import { IndexedDbStorage } from "./IndexedDbStorage";
import { migrateProjectDocument, migrateSettings, MigrationError } from "./migrations";

function doc(id: string, name = "Test"): ProjectDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: "test",
    project: { id, name, createdAt: now, updatedAt: now, originalImageId: "img_aaaaaaaa" },
    images: {
      img_aaaaaaaa: { id: "img_aaaaaaaa", projectId: id, kind: "original", mimeType: "image/png", width: 1, height: 1, byteSize: 1, createdAt: now },
    },
    generations: {},
    jobs: {},
    toPost: [],
  };
}

let counter = 0;

describe("IndexedDbStorage", () => {
  let storage: IndexedDbStorage;

  beforeEach(async () => {
    storage = new IndexedDbStorage(`test-db-${++counter}`);
    await storage.init();
  });

  it("round-trips projects and lists them by recency", async () => {
    const a = doc("prj_aaaaaaaa", "A");
    const b = doc("prj_bbbbbbbb", "B");
    b.project.updatedAt = new Date(Date.now() + 1000).toISOString();
    await storage.saveProject(a);
    await storage.saveProject(b);
    const list = await storage.listProjects();
    expect(list.map((p) => p.name)).toEqual(["B", "A"]);
    expect((await storage.getProject("prj_aaaaaaaa"))?.project.name).toBe("A");
    expect(await storage.getProject("prj_missing1")).toBeNull();
  });

  it("stores and deletes image blobs per project, including on project deletion", async () => {
    const d = doc("prj_cccccccc");
    await storage.saveProject(d);
    const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" });
    await storage.writeImage(d.project.id, "original", "img_aaaaaaaa", blob);
    await storage.writeImage(d.project.id, "thumbnail", "img_aaaaaaaa", blob);
    expect((await storage.readImage(d.project.id, "original", "img_aaaaaaaa"))?.size).toBe(3);
    await storage.deleteProject(d.project.id);
    expect(await storage.getProject(d.project.id)).toBeNull();
    expect(await storage.readImage(d.project.id, "original", "img_aaaaaaaa")).toBeNull();
    expect(await storage.readImage(d.project.id, "thumbnail", "img_aaaaaaaa")).toBeNull();
  });

  it("removes orphaned image files", async () => {
    const d = doc("prj_dddddddd");
    await storage.saveProject(d);
    const blob = new Blob([Uint8Array.from([1])], { type: "image/png" });
    await storage.writeImage(d.project.id, "original", "img_aaaaaaaa", blob);
    await storage.writeImage(d.project.id, "generation", "img_bbbbbbbb", blob);
    expect(await storage.cleanupOrphans(d.project.id)).toBe(1);
    expect(await storage.readImage(d.project.id, "original", "img_aaaaaaaa")).not.toBeNull();
    expect(await storage.readImage(d.project.id, "generation", "img_bbbbbbbb")).toBeNull();
  });

  it("rejects unsafe identifiers before touching storage", async () => {
    await expect(storage.writeImage("../etc", "original", "img_aaaaaaaa", new Blob())).rejects.toThrow(/Invalid identifier/);
  });

  it("persists settings and recipes", async () => {
    expect(await storage.getSettings()).toBeNull();
    await storage.saveSettings({ ...DEFAULT_SETTINGS, locale: "fr" });
    expect((await storage.getSettings())?.locale).toBe("fr");
    const now = new Date().toISOString();
    await storage.saveRecipe({ id: "rcp_aaaaaaaa", name: "R", promptTemplate: "x", category: "custom", createdAt: now, updatedAt: now });
    expect((await storage.listRecipes()).map((r) => r.id)).toEqual(["rcp_aaaaaaaa"]);
    await storage.deleteRecipe("rcp_aaaaaaaa");
    expect(await storage.listRecipes()).toEqual([]);
  });
});

describe("migrations", () => {
  it("upgrades a v0 document", () => {
    const migrated = migrateProjectDocument({ project: { id: "prj_1" }, images: {}, generations: {}, jobs: {} });
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.toPost).toEqual([]);
  });

  it("renames v1 favourites to toPost and is idempotent", () => {
    const v1 = { schemaVersion: 1, project: { id: "prj_1" }, images: {}, generations: {}, jobs: {}, favorites: ["img_a", "img_b"] };
    const migrated = migrateProjectDocument(v1);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.toPost).toEqual(["img_a", "img_b"]);
    expect("favorites" in migrated).toBe(false);
    expect(migrateProjectDocument(migrated)).toEqual(migrated);
  });

  it("refuses documents from newer versions", () => {
    expect(() => migrateProjectDocument({ schemaVersion: 999, project: { id: "x" } })).toThrow(MigrationError);
  });

  it("clamps settings into safe ranges", () => {
    const s = migrateSettings({ maxConcurrentJobs: 50, maxAttempts: 0, jobTimeoutMs: 1 });
    expect(s.maxConcurrentJobs).toBe(8);
    expect(s.maxAttempts).toBe(1);
    expect(s.jobTimeoutMs).toBe(15_000);
  });
});
