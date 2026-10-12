import { z } from "zod";
import { isoDateTime, safeId } from "./common";
import { categorySelection } from "./shared";

const localized = z.strictObject({ en: z.string().max(80), fr: z.string().max(80) });

export const shotSpecDto = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: localized,
  prompt: z.string().max(4000),
});

/** A user's custom recipe (built-in recipes come from the catalogue and are never stored). */
export const recipeDto = z.strictObject({
  id: safeId,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  promptTemplate: z.string().max(4000),
  shots: z.array(shotSpecDto).max(10).optional(),
  pack: categorySelection.optional(),
  category: z.enum(["listing", "product", "portrait", "advertising", "background", "interior", "social", "ecommerce", "custom"]),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
