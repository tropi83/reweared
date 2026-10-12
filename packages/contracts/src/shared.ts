import { z } from "zod";

/** Building blocks used by several contract modules (kept here so no two modules import each other). */
export const CATEGORY_IDS = ["women", "men", "kids", "home", "electronics", "entertainment", "hobbies", "sport", "pets", "luxury"] as const;
export const LISTING_CONDITIONS = ["new_with_tags", "new", "very_good", "good", "satisfactory"] as const;
export const LOCALES = ["en", "fr"] as const;

export const categorySelection = z.strictObject({
  categoryId: z.enum(CATEGORY_IDS),
  subcategoryId: z.string().regex(/^[a-z0-9-]{1,40}$/),
});
