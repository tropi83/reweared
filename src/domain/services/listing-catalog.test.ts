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

  it("produces four distinct, fully interpolated prompts for every subcategory", () => {
    for (const c of LISTING_CATEGORIES) {
      for (const s of c.subcategories) {
        const shots = buildListingShots({ categoryId: c.id, subcategoryId: s.id });
        expect(shots, `${c.id}/${s.id}`).toHaveLength(4);
        expect(new Set(shots.map((x) => x.id)).size).toBe(4);
        expect(new Set(shots.map((x) => x.prompt)).size).toBe(4);
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
    expect(women.map((s) => s.id)).toEqual(["retouch", "studio", "worn", "folded"]);
    expect(buildListingShots({ categoryId: "electronics", subcategoryId: "phones" }).map((s) => s.id)).toEqual(["retouch", "studio", "hand", "back"]);
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
