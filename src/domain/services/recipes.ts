import type { Recipe } from "@/domain/models";
import { buildListingShots, LISTING_CATEGORIES, listingRecipeId } from "./listing-catalog";

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_ -]+?)\s*\}\}/g;

/** Unique variable names in a template, in order of first appearance. */
export function extractVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]?.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

/**
 * Fills `{{variable}}` placeholders. Unfilled variables are removed and surrounding
 * whitespace collapsed so the prompt still reads naturally.
 */
export function interpolate(template: string, values: Record<string, string>): string {
  return template
    .replace(VARIABLE_PATTERN, (_, raw: string) => values[raw.trim()]?.trim() ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

const now = "2026-09-12T00:00:00.000Z";

/**
 * Built-in recipes are the listing packs: one per marketplace subcategory, four shots each.
 * They are generated from the catalogue so labels, prompts and ids have a single source of truth.
 */
export const BUILT_IN_RECIPES: Recipe[] = LISTING_CATEGORIES.flatMap((category) =>
  category.subcategories.map((subcategory) => {
    const listing = { categoryId: category.id, subcategoryId: subcategory.id };
    const shots = buildListingShots(listing);
    return {
      id: listingRecipeId(listing),
      name: `${category.label.en} › ${subcategory.label.en}`,
      description: shots.map((s) => s.label.en).join(" · "),
      category: "listing",
      promptTemplate: shots[0]?.prompt ?? "",
      shots,
      listing,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    } satisfies Recipe;
  }),
);
