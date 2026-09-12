import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@/domain/models";
import { canPost, isFillReport, isVintedLoginUrl, isVintedSellFormUrl, orderedPhotoIds, PUBLISH_LIMITS, stageForUrl } from "./publish";

function doc(over: Partial<ProjectDocument> = {}): ProjectDocument {
  const img = (id: string, kind: "original" | "generation", createdAt: string, generationId?: string) => ({
    id,
    projectId: "prj_1",
    kind,
    mimeType: "image/png" as const,
    width: 10,
    height: 10,
    byteSize: 1,
    createdAt,
    ...(generationId ? { generationId } : {}),
  });
  return {
    schemaVersion: 2,
    appVersion: "0",
    project: {
      id: "prj_1",
      name: "p",
      originalImageId: "orig",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      copy: { title: "Chemise", description: "Blanche", keywords: [], language: "fr", generatedAt: "", provider: "gemini", model: "m" },
    },
    images: {
      orig: img("orig", "original", "2026-01-01T00:00:00Z"),
      g1: img("g1", "generation", "2026-01-02T00:00:00Z", "gen_a"),
      g2: img("g2", "generation", "2026-01-03T00:00:00Z", "gen_b"),
      g3: img("g3", "generation", "2026-01-02T00:00:01Z", "gen_a"),
    },
    generations: {},
    jobs: {},
    toPost: ["g2", "orig", "g1"],
    ...over,
  } as ProjectDocument;
}

describe("canPost", () => {
  it("is ok on desktop with photos and copy", () => expect(canPost(doc(), { desktop: true })).toEqual({ ok: true, reasons: [] }));
  it("lists every blocker", () => {
    expect(canPost(doc({ toPost: [] }), { desktop: true }).reasons).toEqual(["noPhotos"]);
    const noCopy = doc();
    delete noCopy.project.copy;
    expect(canPost(noCopy, { desktop: true }).reasons).toEqual(["noCopy"]);
    expect(canPost(doc(), { desktop: false }).reasons).toEqual(["desktopOnly"]);
    expect(canPost(null, { desktop: true }).reasons).toEqual(["noPhotos", "noCopy"]);
  });
  it("ignores marked ids whose image no longer exists and empty copy", () => {
    expect(canPost(doc({ toPost: ["ghost"] }), { desktop: true }).reasons).toEqual(["noPhotos"]);
    const blank = doc();
    blank.project.copy!.title = "  ";
    expect(canPost(blank, { desktop: true }).reasons).toEqual(["noCopy"]);
  });
});

describe("orderedPhotoIds", () => {
  it("puts the original first, then generations by creation time, skipping unknown ids", () => {
    expect(orderedPhotoIds(doc({ toPost: ["g2", "ghost", "orig", "g3", "g1"] }))).toEqual(["orig", "g1", "g3", "g2"]);
  });
  it("caps at PUBLISH_LIMITS.photos", () => {
    const many: Record<string, ProjectDocument["images"][string]> = {};
    for (let i = 0; i < 25; i++)
      many[`g${i}`] = {
        id: `g${i}`,
        projectId: "prj_1",
        kind: "generation",
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteSize: 1,
        createdAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      };
    expect(orderedPhotoIds(doc({ images: many, toPost: Object.keys(many) }))).toHaveLength(PUBLISH_LIMITS.photos);
  });
});

describe("Vinted URLs", () => {
  it("classifies hosts, login and sell-form pages", () => {
    expect(isVintedSellFormUrl("https://www.vinted.fr/items/new")).toBe(true);
    expect(isVintedSellFormUrl("https://www.vinted.co.uk/items/new?ref=x")).toBe(true);
    expect(isVintedSellFormUrl("https://www.vinted.fr/items/123-chemise")).toBe(false);
    expect(isVintedSellFormUrl("https://evil.com/items/new")).toBe(false);
    expect(isVintedLoginUrl("https://www.vinted.fr/member/signup/select_type?ref_url=%2Fitems%2Fnew")).toBe(true);
    expect(isVintedLoginUrl("https://www.vinted.fr/member/login")).toBe(true);
    expect(isVintedLoginUrl("https://accounts.google.com/o/oauth2/auth")).toBe(true);
    expect(isVintedLoginUrl("https://www.vinted.fr/")).toBe(false);
  });
  it("maps URLs to stages", () => {
    expect(stageForUrl(undefined)).toBe("closed");
    expect(stageForUrl("https://www.vinted.fr/member/login")).toBe("login");
    expect(stageForUrl("https://www.vinted.fr/")).toBe("browsing");
    expect(stageForUrl("https://www.vinted.fr/items/new")).toBe("form");
    expect(stageForUrl("not a url")).toBe("browsing");
  });
});

describe("isFillReport", () => {
  it("accepts the script's status shape only", () => {
    expect(isFillReport({ pageOk: true, title: "filled", description: "not_found", photos: { requested: 3, attached: 2 } })).toBe(true);
    expect(isFillReport({ pageOk: true, title: "yes", description: "filled", photos: { requested: 1, attached: 1 } })).toBe(false);
    expect(isFillReport(null)).toBe(false);
  });
});
