export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export type ImageAssetKind = "original" | "generation";

/**
 * A stored image. The bytes live in the StorageProvider (filesystem / IndexedDB);
 * this record only carries metadata. Thumbnails share the asset id under the "thumbnail" bucket.
 */
export interface ImageAsset {
  id: string;
  projectId: string;
  kind: ImageAssetKind;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  /** Size in bytes of the full-resolution file. */
  byteSize: number;
  /** Original file name for imported images, when known. */
  fileName?: string;
  /** Generation that produced this asset (undefined for imported originals). */
  generationId?: string;
  /** Job that produced this asset. */
  jobId?: string;
  createdAt: string;
}

export const SUPPORTED_INPUT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif"] as const;

export type SupportedInputMimeType = (typeof SUPPORTED_INPUT_MIME_TYPES)[number];

export function isSupportedInputMimeType(value: string): value is SupportedInputMimeType {
  return (SUPPORTED_INPUT_MIME_TYPES as readonly string[]).includes(value);
}

/** Hard cap on imported files. Larger files are rejected before decoding. */
export const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
/** Longest side of gallery thumbnails. */
export const THUMBNAIL_DIMENSION = 512;
