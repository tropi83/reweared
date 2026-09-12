import { describe, expect, it } from "vitest";
import { buildListingShots, findSubcategory, LISTING_CATEGORIES, listingRecipeId, listingSelectionFromRecipeId, PRODUCT_KINDS } from "./listing-catalog";

describe("listing catalogue", () => {
  it("covers the ten marketplace categories with unique ids and localized labels", () => {
    expect(LISTING_CATEGORIES.map((c) => c.id)).toEqual(["women", "men", "kids", "home", "electronics", "entertainment", "hobbies", "sport", "pets", "luxury"]);
    for (const c of LISTING_CATEGORIES) {
      expect(c.label.en.length).toBeGreaterThan(0);
      expect(c.label.fr.length).toBeGreaterThan(0);
      expect(c.subcategories.length).toBeGreaterThanOrEqual(4);
      expect(new Set(c.subcategories.map((s) => s.id)).size).toBe(c.subcategories.length);
      for (const s of c.subcategories) {
        expect(PRODUCT_KINDS).toContain(s.kind);
        expect(s.subject.length).toBeGreaterThan(2);
      }
    }
  });

  it("produces four or five distinct, fully interpolated prompts for every subcategory", () => {
    for (const c of LISTING_CATEGORIES) {
      for (const s of c.subcategories) {
        const shots = buildListingShots({ categoryId: c.id, subcategoryId: s.id });
        expect(shots.length, `${c.id}/${s.id}`).toBeGreaterThanOrEqual(4);
        expect(shots.length, `${c.id}/${s.id}`).toBeLessThanOrEqual(5);
        expect(new Set(shots.map((x) => x.id)).size).toBe(shots.length);
        expect(new Set(shots.map((x) => x.prompt)).size).toBe(shots.length);
        for (const shot of shots) {
          expect(shot.prompt).not.toMatch(/\{\{/);
          expect(shot.prompt).toContain(s.subject);
          expect(shot.prompt).toMatch(/reference image/);
          expect(shot.prompt.length).toBeLessThan(700);
          expect(shot.label.fr.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("adapts the in-use shot to the wearer of the category", () => {
    const women = buildListingShots({ categoryId: "women", subcategoryId: "clothing" });
    const kids = buildListingShots({ categoryId: "kids", subcategoryId: "clothing" });
    const men = buildListingShots({ categoryId: "men", subcategoryId: "shoes" });
    expect(women.find((s) => s.id === "worn")?.prompt).toContain("worn by a woman");
    expect(kids.find((s) => s.id === "worn")?.prompt).toContain("a child, face not visible");
    expect(men.find((s) => s.id === "worn")?.prompt).toContain("worn by a man");
    expect(women.map((s) => s.id)).toEqual(["retouch", "studio", "worn", "selfie", "folded"]);
    expect(women.find((s) => s.id === "selfie")?.prompt).toContain("mirror selfie taken by a woman");
    expect(men.map((s) => s.id)).toEqual(["retouch", "studio", "worn", "selfie", "profile"]);
    expect(buildListingShots({ categoryId: "electronics", subcategoryId: "phones" }).map((s) => s.id)).toEqual(["retouch", "studio", "hand", "back"]);
  });

  it("adds the mirror selfie only to wearable kinds and never for kids", () => {
    const hasSelfie = (categoryId: Parameters<typeof buildListingShots>[0]["categoryId"], subcategoryId: string) =>
      buildListingShots({ categoryId, subcategoryId }).some((s) => s.id === "selfie");
    expect(hasSelfie("women", "bags")).toBe(true);
    expect(hasSelfie("men", "accessories")).toBe(true);
    expect(hasSelfie("luxury", "watches")).toBe(true);
    expect(hasSelfie("luxury", "jewelry")).toBe(true);
    expect(hasSelfie("kids", "clothing")).toBe(false);
    expect(hasSelfie("kids", "shoes")).toBe(false);
    expect(hasSelfie("home", "furniture")).toBe(false);
    expect(hasSelfie("electronics", "phones")).toBe(false);
    // Kids never get a selfie in any subcategory.
    const kids = LISTING_CATEGORIES.find((c) => c.id === "kids")!;
    for (const sub of kids.subcategories) expect(hasSelfie("kids", sub.id), sub.id).toBe(false);
  });

  it("round-trips built-in recipe ids and rejects unknown selections", () => {
    const sel = { categoryId: "entertainment" as const, subcategoryId: "video-games" };
    const id = listingRecipeId(sel);
    expect(id).toBe("rcp_listing_entertainment_videogames");
    expect(listingSelectionFromRecipeId(id)).toEqual(sel);
    expect(listingSelectionFromRecipeId("rcp_listing_nope_x")).toBeUndefined();
    expect(findSubcategory({ categoryId: "women", subcategoryId: "nope" })).toBeUndefined();
    expect(() => buildListingShots({ categoryId: "women", subcategoryId: "nope" })).toThrow();
  });
});
