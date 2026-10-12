import sharp from "sharp";
import type { AspectRatio, ImageSize, ModelInfo } from "@aiv/domain/models";
import { computeGeometry } from "@aiv/domain/services/image-geometry";
import { inputPreparationFor } from "@aiv/domain/services/image-provider";

/** Longest side sent to models that do not ask for a specific input size (same default as the app). */
const FALLBACK_MAX_DIMENSION = 3072;

/**
 * The worker's version of the app's `prepareForProvider`: the same rectangles (`computeGeometry` from the domain),
 * cut and resized with sharp instead of a canvas, in the format the model wants. No metadata is written.
 */
export async function prepareSource(
  bytes: Buffer,
  model: ModelInfo,
  request: { aspectRatio: AspectRatio; imageSize?: ImageSize | undefined },
): Promise<{ blob: Blob; mimeType: "image/png" | "image/jpeg" }> {
  const preparation = inputPreparationFor(
    model,
    { aspectRatio: request.aspectRatio, ...(request.imageSize ? { imageSize: request.imageSize } : {}) },
    FALLBACK_MAX_DIMENSION,
  );
  const image = sharp(bytes, { autoOrient: true, failOn: "warning", limitInputPixels: 50_000_000 });
  const { width = 0, height = 0 } = await image.metadata();
  const geometry = computeGeometry(width, height, {
    maxDimension: preparation.maxDimension,
    ...(preparation.cropToAspectRatio ? { aspectRatio: preparation.cropToAspectRatio } : {}),
    ...(preparation.multipleOf ? { multipleOf: preparation.multipleOf } : {}),
  });
  const cut = image
    .extract({ left: Math.round(geometry.sx), top: Math.round(geometry.sy), width: Math.round(geometry.sw), height: Math.round(geometry.sh) })
    .resize({ width: geometry.width, height: geometry.height, fit: "fill" });
  const out = preparation.format === "image/jpeg" ? await cut.jpeg({ quality: 92 }).toBuffer() : await cut.png().toBuffer();
  return { blob: new Blob([new Uint8Array(out)], { type: preparation.format }), mimeType: preparation.format };
}
