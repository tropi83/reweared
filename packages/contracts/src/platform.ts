import { z } from "zod";
import { ASPECT_RATIOS } from "./generation";

/** What the apps need to know about the platform's runs without hard-coding it. Public: nothing secret. */
export const platformDto = z.object({
  runCost: z.object({ image: z.number().int().nonnegative(), copy: z.number().int().nonnegative() }),
  freeMonthlyCredits: z.number().int().nonnegative(),
  imageModel: z.object({
    aspectRatios: z.array(z.enum(ASPECT_RATIOS)),
    options: z.array(
      z.object({
        key: z.string(),
        labelKey: z.string(),
        type: z.enum(["number", "text", "boolean"]),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        default: z.union([z.number(), z.string(), z.boolean()]),
      }),
    ),
  }),
});
