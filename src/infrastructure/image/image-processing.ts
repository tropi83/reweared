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
export async function prepareForProvider(blob: Blob, sourceMime: string, maxDimension: number): Promise<PreparedImage> {
  const { bitmap, width, height } = await decodeImage(blob);
  try {
    const fits = Math.max(width, height) <= maxDimension;
    const isProviderNative = sourceMime === "image/png" || sourceMime === "image/jpeg";
    if (fits && isProviderNative) {
      return { blob, mimeType: sourceMime, width, height };
    }
    const keepAlpha = sourceMime === "image/png" || sourceMime === "image/webp" || sourceMime === "image/gif" || sourceMime === "image/avif";
    const type = keepAlpha ? "image/png" : "image/jpeg";
    const encoded = await encodeBitmap(bitmap, { maxDimension, type, quality: 0.92 });
    return { blob: encoded.blob, mimeType: type, width: encoded.width, height: encoded.height };
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
