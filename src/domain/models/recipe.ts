import type { ListingSelection, ShotSpec } from "./listing";

export type RecipeCategory = "listing" | "product" | "portrait" | "advertising" | "background" | "interior" | "social" | "ecommerce" | "custom";

export const RECIPE_CATEGORIES: RecipeCategory[] = ["listing", "product", "portrait", "advertising", "background", "interior", "social", "ecommerce", "custom"];

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  /** May contain `{{variable}}` placeholders, filled in by the composer. Used when `shots` is absent. */
  promptTemplate: string;
  /** Listing packs: one job per shot, each with its own prompt. */
  shots?: ShotSpec[];
  /** Set for built-in listing packs so the composer can preselect the taxonomy. */
  listing?: ListingSelection;
  category: RecipeCategory;
  /** Built-in recipes cannot be deleted, only duplicated. */
  builtIn?: boolean;
  createdAt: string;
  updatedAt: string;
}
