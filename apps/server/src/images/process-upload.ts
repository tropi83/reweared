import { createHash } from "node:crypto";
import sharp from "sharp";
import { AppError, THUMBNAIL_DIMENSION, type ImageMimeType } from "@aiv/domain/models";
import { IMAGE_SNIFF_BYTES, sniffImageMime } from "@aiv/domain/lib/image-sniff";
import { HttpError } from "../http/errors";
import type { ObjectExtension } from "../storage/keys";

/** Larger inputs are refused before decoding (≈ 7000 × 7000; phone photos are 12–50 MP). */
const MAX_INPUT_PIXELS = 50_000_000;

export interface ProcessedUpload {
  original: { bytes: Buffer; mimeType: ImageMimeType; extension: ObjectExtension; width: number; height: number };
  thumbnail: { bytes: Buffer };
  /** Of the stored original (what clients download); used as the ETag. */
  sha256: string;
}

const OUTPUT: Record<string, { mimeType: ImageMimeType; extension: ObjectExtension }> = {
  "image/jpeg": { mimeType: "image/jpeg", extension: "jpg" },
  "image/png": { mimeType: "image/png", extension: "png" },
  "image/webp": { mimeType: "image/webp", extension: "webp" },
  // Re-encoded to PNG like the clients do on import.
  "image/gif": { mimeType: "image/png", extension: "png" },
  "image/avif": { mimeType: "image/png", extension: "png" },
};

/**
 * Turns an uploaded file into what we store. The declared type is ignored: the format comes from the magic bytes.
 * The image is decoded (pixel limit, `failOn: "warning"` as sharp recommends for untrusted input), turned upright
 * from its EXIF orientation and re-encoded — sharp writes no EXIF, GPS, XMP, IPTC or ICC metadata unless asked to,
 * and converts to sRGB. BMP is refused (sharp cannot decode it; the clients convert it first).
 */
export async function processUpload(bytes: Buffer, options: { maxBytes: number }): Promise<ProcessedUpload> {
  if (bytes.length === 0) throw new AppError("INVALID_IMAGE", "The file is empty.");
  if (bytes.length > options.maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The file is too large.");
  const sniffed = sniffImageMime(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  const output = sniffed ? OUTPUT[sniffed] : undefined;
  if (!output) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported image format. Use JPEG, PNG, WebP, GIF or AVIF.");

  try {
    const decoded = sharp(bytes, { autoOrient: true, limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" });
    const encoded =
      output.mimeType === "image/jpeg"
        ? decoded.jpeg({ quality: 92, mozjpeg: true })
        : output.mimeType === "image/webp"
          ? decoded.webp({ quality: 92 })
          : decoded.png();
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(data)
      .resize({ width: THUMBNAIL_DIMENSION, height: THUMBNAIL_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      original: { bytes: data, mimeType: output.mimeType, extension: output.extension, width: info.width, height: info.height },
      thumbnail: { bytes: thumbnail },
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  } catch {
    // sharp's message may quote the input; the client gets a fixed one.
    throw new AppError("INVALID_IMAGE", "The file could not be read as an image.");
  }
}

/** A display name from the uploaded file name: no path, no control characters, at most 120 characters. */
export function safeFileName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean ? clean.slice(0, 120) : undefined;
}
