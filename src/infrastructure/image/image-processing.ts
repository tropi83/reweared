import { AppError, MAX_IMPORT_BYTES, THUMBNAIL_DIMENSION, isSupportedInputMimeType, type ImageMimeType, type SupportedInputMimeType } from "@/domain/models";

/**
 * Detects the real image type from magic bytes. The browser-provided `File.type` is only a hint
 * (it comes from the extension) and is never trusted on its own.
 */
export async function sniffMimeType(blob: Blob): Promise<string | null> {
  const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const startsWith = (bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith([0x42, 0x4d])) return "image/bmp";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...head.slice(8, 12));
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
  }
  return null;
}

export interface ValidatedImage {
  blob: Blob;
  mimeType: SupportedInputMimeType;
}

/** Size + MIME validation before any decoding happens. */
export async function validateImageFile(blob: Blob): Promise<ValidatedImage> {
  if (blob.size === 0) throw new AppError("INVALID_IMAGE", "The file is empty.");
  if (blob.size > MAX_IMPORT_BYTES) {
    throw new AppError("INVALID_IMAGE", `The file is larger than ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB.`, { detail: "TOO_LARGE" });
  }
  const sniffed = await sniffMimeType(blob);
  if (!sniffed || !isSupportedInputMimeType(sniffed)) {
    throw new AppError("UNSUPPORTED_FORMAT", "Unsupported image format.");
  }
  return { blob, mimeType: sniffed };
}

export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/**
 * Decodes safely through the browser's decoder with EXIF orientation applied, so every
 * downstream operation sees upright pixels. Caller must `bitmap.close()`.
 */
export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    if (bitmap.width === 0 || bitmap.height === 0) throw new Error("empty");
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch (err) {
    throw new AppError("INVALID_IMAGE", "This image could not be decoded.", { cause: err });
  }
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(canvas: AnyCanvas, type: ImageMimeType, quality?: number): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, ...(quality !== undefined ? { quality } : {}) });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new AppError("INVALID_IMAGE", "Encoding failed."))), type, quality));
}

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

/** Draws a bitmap through a Geometry (crop + resize) into a new blob. */
export async function encodeBitmapWithGeometry(bitmap: ImageBitmap, geometry: Geometry, type: ImageMimeType, quality?: number): Promise<Blob> {
  const canvas = createCanvas(geometry.width, geometry.height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new AppError("INVALID_IMAGE", "Canvas unavailable.");
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, geometry.width, geometry.height);
  }
  ctx.drawImage(bitmap, geometry.sx, geometry.sy, geometry.sw, geometry.sh, 0, 0, geometry.width, geometry.height);
  return canvasToBlob(canvas, type, quality);
}

export interface EncodeOptions {
  maxDimension?: number;
  type: ImageMimeType;
  quality?: number;
}

/** Draws a bitmap (optionally downscaled) into a new blob of the requested type. */
export async function encodeBitmap(bitmap: ImageBitmap, options: EncodeOptions): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = options.maxDimension ? fitWithin(bitmap.width, bitmap.height, options.maxDimension) : bitmap;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new AppError("INVALID_IMAGE", "Canvas unavailable.");
  if (options.type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, options.type, options.quality);
  return { blob, width, height };
}

/** Gallery thumbnail: WebP, longest side THUMBNAIL_DIMENSION. */
export async function createThumbnail(bitmap: ImageBitmap): Promise<Blob> {
  const { blob } = await encodeBitmap(bitmap, { maxDimension: THUMBNAIL_DIMENSION, type: "image/webp", quality: 0.82 });
  return blob;
}

export interface PreparedImage {
  blob: Blob;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

/**
 * Builds the image sent to a provider: upright, downscaled to `maxDimension`, encoded as
 * PNG (when the source has transparency-capable format and is small) or JPEG. The stored
 * original is never touched.
 */
export interface PrepareOptions {
  maxDimension: number;
  /** Centre-crop to this ratio ("4:5"); the output then has exactly that ratio. */
  cropToAspectRatio?: string;
  /** Round output dimensions down to a multiple of this value. */
  multipleOf?: number;
  /** Force this output format instead of choosing from the source. */
  format?: "image/png" | "image/jpeg";
}

export async function prepareForProvider(blob: Blob, sourceMime: string, options: number | PrepareOptions): Promise<PreparedImage> {
  const opts: PrepareOptions = typeof options === "number" ? { maxDimension: options } : options;
  const { bitmap, width, height } = await decodeImage(blob);
  try {
    const geometry = computeGeometry(width, height, {
      maxDimension: opts.maxDimension,
      ...(opts.cropToAspectRatio ? { aspectRatio: opts.cropToAspectRatio } : {}),
      ...(opts.multipleOf ? { multipleOf: opts.multipleOf } : {}),
    });
    const untouched = geometry.width === width && geometry.height === height && geometry.sw === width && geometry.sh === height;
    const isProviderNative = sourceMime === "image/png" || sourceMime === "image/jpeg";
    const formatMatches = !opts.format || opts.format === sourceMime;
    if (untouched && isProviderNative && formatMatches) {
      return { blob, mimeType: sourceMime, width, height };
    }
    const keepAlpha = sourceMime === "image/png" || sourceMime === "image/webp" || sourceMime === "image/gif" || sourceMime === "image/avif";
    const type = opts.format ?? (keepAlpha ? "image/png" : "image/jpeg");
    const out = await encodeBitmapWithGeometry(bitmap, geometry, type, type === "image/jpeg" ? 0.92 : undefined);
    return { blob: out, mimeType: type, width: geometry.width, height: geometry.height };
  } finally {
    bitmap.close();
  }
}

/** Re-encodes an image for export. Returns the source blob untouched when the type matches. */
export async function convertForExport(blob: Blob, type: ImageMimeType, quality = 0.92): Promise<Blob> {
  if (blob.type === type) return blob;
  const { bitmap } = await decodeImage(blob);
  try {
    const { blob: out } = await encodeBitmap(bitmap, { type, quality: type === "image/png" ? undefined : quality });
    return out;
  } finally {
    bitmap.close();
  }
}

export function extensionFor(type: ImageMimeType): string {
  return type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
}
