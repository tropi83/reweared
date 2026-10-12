/**
 * Crop + resize arithmetic for preparing a source image for a model (`ModelCapabilities.inputImage`): pure, so the
 * app's canvas pipeline and the worker's sharp pipeline compute the same rectangles.
 */

export function fitWithin(width: number, height: number, maxDimension: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const scale = maxDimension / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface Geometry {
  /** Source rectangle to crop (in source pixels). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Output size. */
  width: number;
  height: number;
}

/**
 * Computes a centre crop to `aspectRatio` (optional), a resize so the longest side is at most
 * `maxDimension`, and rounds the output down to `multipleOf` (diffusion models need 8 or 64).
 * Pure so it can be unit-tested without a canvas.
 */
export function computeGeometry(width: number, height: number, opts: { maxDimension: number; aspectRatio?: string; multipleOf?: number }): Geometry {
  let sx = 0;
  let sy = 0;
  let sw = width;
  let sh = height;
  if (opts.aspectRatio) {
    const [rw, rh] = opts.aspectRatio.split(":").map(Number) as [number, number];
    const target = rw / rh;
    if (width / height > target) {
      sw = Math.round(height * target);
      sx = Math.round((width - sw) / 2);
    } else if (width / height < target) {
      sh = Math.round(width / target);
      sy = Math.round((height - sh) / 2);
    }
  }
  let out = fitWithin(sw, sh, opts.maxDimension);
  if (opts.multipleOf && opts.multipleOf > 1) {
    const m = opts.multipleOf;
    out = { width: Math.max(m, Math.floor(out.width / m) * m), height: Math.max(m, Math.floor(out.height / m) * m) };
  }
  return { sx, sy, sw, sh, width: out.width, height: out.height };
}
