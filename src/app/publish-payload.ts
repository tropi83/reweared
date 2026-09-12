import type { ImageAsset, ListingDocument } from "@/domain/models";
import { orderedPhotoIds, PUBLISH_LIMITS, type PublishPayload, type PublishPhoto } from "@/domain/services/publish";
import { prepareForProvider } from "@/infrastructure/image/image-processing";
import { blobToBase64 } from "@/infrastructure/providers/gemini/GeminiMapper";

/** Vinted re-encodes uploads anyway; 2048 px JPEG keeps each photo well under the 4 MiB transfer cap. */
const PHOTO_MAX_DIMENSION = 2048;

/**
 * Builds what the injected script types into the sell form: trimmed copy capped at Vinted's
 * limits and the marked photos (posting order) re-encoded and base64'd. Unreadable or
 * oversized photos are skipped rather than failing the whole fill.
 */
export async function buildPublishPayload(doc: ListingDocument, readImage: (asset: ImageAsset) => Promise<Blob | null>): Promise<PublishPayload> {
  const copy = doc.listing.copy;
  const photos: PublishPhoto[] = [];
  for (const [index, id] of orderedPhotoIds(doc).entries()) {
    const asset = doc.images[id];
    if (!asset) continue;
    const blob = await readImage(asset);
    if (!blob) continue;
    const prepared = await prepareForProvider(blob, asset.mimeType, { maxDimension: PHOTO_MAX_DIMENSION, format: "image/jpeg" });
    if (prepared.blob.size > PUBLISH_LIMITS.photoBytes) continue;
    photos.push({
      name: `photo-${index + 1}.jpg`,
      mimeType: prepared.mimeType === "image/png" ? "image/png" : "image/jpeg",
      data: await blobToBase64(prepared.blob),
    });
  }
  return {
    title: (copy?.title ?? "").trim().slice(0, PUBLISH_LIMITS.title),
    description: (copy?.description ?? "").trim().slice(0, PUBLISH_LIMITS.description),
    photos,
  };
}
