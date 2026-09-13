import { describe, expect, it } from "vitest";
import { buildShots, softenForSafetyFilter, findSubcategory, CATEGORIES, catalogRecipeId, categorySelectionFromRecipeId, PRODUCT_KINDS } from "./catalog";

describe("softenForSafetyFilter", () => {
  it("drops the logo / text clause of the fidelity preamble and leaves other prompts alone", () => {
    const shot = buildShots({ categoryId: "men", subcategoryId: "shoes" })[0]!;
    const soft = softenForSafetyFilter(shot.prompt);
    expect(shot.prompt).toContain("logos and any visible text identical");
    expect(soft).not.toContain("logos");
    expect(soft).toContain("Keep its shape, proportions, colors, pattern and material identical; do not add or remove elements.");
    expect(soft.length).toBeLessThan(shot.prompt.length);
    expect(softenForSafetyFilter("a custom prompt")).toBe("a custom prompt");
  });
});

describe("listing catalogue", () => {
  it("covers the ten marketplace categories with unique ids and localized labels", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(["women", "men", "kids", "home", "electronics", "entertainment", "hobbies", "sport", "pets", "luxury"]);
    for (const c of CATEGORIES) {
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
    for (const c of CATEGORIES) {
      for (const s of c.subcategories) {
        const shots = buildShots({ categoryId: c.id, subcategoryId: s.id });
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
    const women = buildShots({ categoryId: "women", subcategoryId: "clothing" });
    const kids = buildShots({ categoryId: "kids", subcategoryId: "clothing" });
    const men = buildShots({ categoryId: "men", subcategoryId: "shoes" });
    expect(women.find((s) => s.id === "worn")?.prompt).toContain("worn by a woman");
    expect(kids.find((s) => s.id === "worn")?.prompt).toContain("a child, face not visible");
    expect(men.find((s) => s.id === "worn")?.prompt).toContain("worn by a man");
    expect(women.map((s) => s.id)).toEqual(["retouch", "studio", "worn", "selfie", "folded"]);
    expect(women.find((s) => s.id === "selfie")?.prompt).toContain("mirror selfie taken by a woman");
    // Anything that can be ironed is shown ironed when folded or laid flat.
    expect(women.find((s) => s.id === "folded")?.prompt).toMatch(/freshly ironed.*wrinkle/);
    expect(women.find((s) => s.id === "studio")?.prompt).toContain("wrinkle-free");
    expect(buildShots({ categoryId: "home", subcategoryId: "textile" }).find((s) => s.id === "studio")?.prompt).toContain("freshly ironed");
    expect(men.map((s) => s.id)).toEqual(["retouch", "studio", "worn", "selfie", "profile"]);
    expect(buildShots({ categoryId: "electronics", subcategoryId: "phones" }).map((s) => s.id)).toEqual(["retouch", "studio", "hand", "back"]);
  });

  it("adds the mirror selfie only to wearable kinds and never for kids", () => {
    const hasSelfie = (categoryId: Parameters<typeof buildShots>[0]["categoryId"], subcategoryId: string) =>
      buildShots({ categoryId, subcategoryId }).some((s) => s.id === "selfie");
    expect(hasSelfie("women", "bags")).toBe(true);
    expect(hasSelfie("men", "accessories")).toBe(true);
    expect(hasSelfie("luxury", "watches")).toBe(true);
    expect(hasSelfie("luxury", "jewelry")).toBe(true);
    expect(hasSelfie("kids", "clothing")).toBe(false);
    expect(hasSelfie("kids", "shoes")).toBe(false);
    expect(hasSelfie("home", "furniture")).toBe(false);
    expect(hasSelfie("electronics", "phones")).toBe(false);
    // Kids never get a selfie in any subcategory.
    const kids = CATEGORIES.find((c) => c.id === "kids")!;
    for (const sub of kids.subcategories) expect(hasSelfie("kids", sub.id), sub.id).toBe(false);
  });

  it("keeps the default poses when no mannequin is given", () => {
    expect(buildShots({ categoryId: "women", subcategoryId: "clothing" }).find((s) => s.id === "worn")?.prompt).toContain(
      "worn by a woman, standing naturally,",
    );
    expect(buildShots({ categoryId: "men", subcategoryId: "shoes" }).find((s) => s.id === "worn")?.prompt).toContain("worn by a man, standing, cropped");
  });

  it("puts the seller's mannequin in every shot with a person, with a single pose", () => {
    const mannequin = { build: "S", pose: "crouching", skinTone: "brown" } as const;
    const shots = buildShots({ categoryId: "women", subcategoryId: "clothing" }, { mannequin });
    const byId = Object.fromEntries(shots.map((s) => [s.id, s.prompt]));
    expect(byId.worn).toContain("worn by a woman with a slim build and brown skin, crouching down,");
    expect(byId.worn).not.toContain("standing naturally");
    expect(byId.selfie).toContain("mirror selfie taken by a woman with a slim build and brown skin");
    expect(byId.selfie).toMatch(/The person is crouching down\.$/);
    const plain = buildShots({ categoryId: "women", subcategoryId: "clothing" });
    for (const id of ["retouch", "studio", "folded"]) expect(byId[id], id).toBe(plain.find((s) => s.id === id)?.prompt);
    for (const s of shots)
      expect(s.prompt.match(/standing naturally|crouching down|sitting on a stool|arched back/g)?.length ?? 0, s.id).toBeLessThanOrEqual(1);
  });

  it("interpolates every subcategory with a mannequin", () => {
    const mannequin = { build: "L", pose: "arched", skinTone: "very-fair" } as const;
    for (const c of CATEGORIES)
      for (const s of c.subcategories)
        for (const shot of buildShots({ categoryId: c.id, subcategoryId: s.id }, { mannequin }))
          expect(shot.prompt, `${c.id}/${s.id}/${shot.id}`).not.toMatch(/\{\{/);
  });

  it("ignores the mannequin for kids and pets", () => {
    const mannequin = { build: "L", pose: "sitting", skinTone: "fair" } as const;
    for (const categoryId of ["kids", "pets"] as const) {
      const subcategoryId = CATEGORIES.find((c) => c.id === categoryId)!.subcategories[0]!.id;
      expect(buildShots({ categoryId, subcategoryId }, { mannequin })).toEqual(buildShots({ categoryId, subcategoryId }));
    }
  });

  it("round-trips built-in recipe ids and rejects unknown selections", () => {
    const sel = { categoryId: "entertainment" as const, subcategoryId: "video-games" };
    const id = catalogRecipeId(sel);
    expect(id).toBe("rcp_listing_entertainment_videogames");
    expect(categorySelectionFromRecipeId(id)).toEqual(sel);
    expect(categorySelectionFromRecipeId("rcp_listing_nope_x")).toBeUndefined();
    expect(findSubcategory({ categoryId: "women", subcategoryId: "nope" })).toBeUndefined();
    expect(() => buildShots({ categoryId: "women", subcategoryId: "nope" })).toThrow();
  });
});
