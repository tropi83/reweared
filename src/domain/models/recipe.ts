export type RecipeCategory = "product" | "portrait" | "advertising" | "background" | "interior" | "social" | "ecommerce" | "custom";

export const RECIPE_CATEGORIES: RecipeCategory[] = ["product", "portrait", "advertising", "background", "interior", "social", "ecommerce", "custom"];

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  /** May contain `{{variable}}` placeholders, filled in by the composer. */
  promptTemplate: string;
  category: RecipeCategory;
  /** Built-in recipes cannot be deleted, only duplicated. */
  builtIn?: boolean;
  createdAt: string;
  updatedAt: string;
}
