/** Every category and every subcategory of the catalogue has an icon; nothing falls through unnoticed. */
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/domain/services/catalog";
import { CATEGORY_ICONS, categoryIcon, SUBCATEGORY_ICONS, subcategoryIcon } from "./category-icons";

describe("category icons", () => {
  it("covers the 10 categories with distinct icons", () => {
    const icons = CATEGORIES.map((c) => CATEGORY_ICONS[c.id]);
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(CATEGORIES.length);
  });

  it("covers all 56 subcategories explicitly (no silent fallback to the category icon)", () => {
    const missing = CATEGORIES.flatMap((c) => c.subcategories.filter((s) => !SUBCATEGORY_ICONS[`${c.id}/${s.id}`]).map((s) => `${c.id}/${s.id}`));
    expect(missing).toEqual([]);
    expect(Object.keys(SUBCATEGORY_ICONS)).toHaveLength(CATEGORIES.reduce((n, c) => n + c.subcategories.length, 0));
  });

  it("resolves icons for a selection and falls back to the category for unknown ids", () => {
    expect(subcategoryIcon({ categoryId: "women", subcategoryId: "shoes" })).toBe(SUBCATEGORY_ICONS["women/shoes"]);
    expect(subcategoryIcon({ categoryId: "women", subcategoryId: "nope" })).toBe(CATEGORY_ICONS.women);
    expect(categoryIcon("pets")).toBe(CATEGORY_ICONS.pets);
  });
});
