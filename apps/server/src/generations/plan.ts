import { randomInt } from "node:crypto";
import type { AspectRatio, CategorySelection, Mannequin, ModelInfo, ShotSpec } from "@aiv/domain/models";
import { buildShots } from "@aiv/domain/services/catalog";
import { buildRequestForModel } from "@aiv/domain/services/image-provider";
import { HttpError } from "../http/errors";

export interface ImageJobPlan {
  index: number;
  prompt: string;
  shotId: string;
  shotLabel: ShotSpec["label"];
  aspectRatio: AspectRatio;
  providerOptions?: Record<string, string | number | boolean>;
  seed: number;
}

/** A seed in FLUX's range, different for every job (the providers return the same image for the same seed). */
export function randomJobSeed(): number {
  return randomInt(0, 2_147_483_647);
}

/**
 * One job per shot of the listing's pack, with the clients' exact prompts (`buildShots`, the seller's mannequin
 * when the listing uses it — the catalogue itself skips kids and pets). Per-run options are filtered against the
 * platform model: an aspect ratio it does not support falls back to the source's, unknown options are dropped.
 */
export function planImageJobs(input: {
  category: CategorySelection | null;
  useMannequin: boolean;
  mannequin: Mannequin | undefined;
  model: ModelInfo;
  shotIds?: string[] | undefined;
  aspectRatio?: AspectRatio | undefined;
  options?: Record<string, string | number | boolean> | undefined;
}): ImageJobPlan[] {
  if (!input.category) throw new HttpError(400, "VALIDATION_FAILED", "Choose the listing's category first.");
  let shots: ShotSpec[];
  try {
    shots = buildShots(input.category, input.useMannequin && input.mannequin ? { mannequin: input.mannequin } : {});
  } catch {
    throw new HttpError(400, "VALIDATION_FAILED", "Unknown category.");
  }
  if (input.shotIds) {
    const unknown = input.shotIds.filter((id) => !shots.some((s) => s.id === id));
    if (unknown.length > 0) throw new HttpError(400, "VALIDATION_FAILED", "Unknown shot.");
    shots = shots.filter((s) => input.shotIds?.includes(s.id));
  }
  const allowedOptions = new Set((input.model.capabilities.options ?? []).map((o) => o.key));
  const options = Object.fromEntries(Object.entries(input.options ?? {}).filter(([key]) => allowedOptions.has(key)));
  return shots.map((shot, index) => {
    const request = buildRequestForModel(input.model, { prompt: shot.prompt, aspectRatio: input.aspectRatio ?? "original", options });
    return {
      index,
      prompt: shot.prompt,
      shotId: shot.id,
      shotLabel: shot.label,
      aspectRatio: request.aspectRatio ?? "original",
      ...(request.options ? { providerOptions: request.options } : {}),
      seed: randomJobSeed(),
    };
  });
}
