/** Image types recognised from their magic bytes (a superset of what each side accepts). */
export type SniffedImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/webp" | "image/avif";

/** How many leading bytes `sniffImageMime` needs. */
export const IMAGE_SNIFF_BYTES = 32;

/**
 * Detects the real image type from magic bytes. A declared type (file extension, `File.type`, multipart
 * `Content-Type`) is only a hint and is never trusted on its own — by the app on import nor by the server
 * on upload.
 */
export function sniffImageMime(head: Uint8Array): SniffedImageMime | null {
  const startsWith = (bytes: number[], offset = 0) => head.length >= offset + bytes.length && bytes.every((b, i) => head[offset + i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith([0x42, 0x4d])) return "image/bmp";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4) && head.length >= 12) {
    const brand = String.fromCharCode(...head.slice(8, 12));
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
  }
  return null;
}
