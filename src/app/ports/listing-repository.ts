import type { ImageAsset, ImageMimeType, ListingDocument, ListingSummary } from "@aiv/domain/models";
import type { ImageBucket } from "@/infrastructure/storage";

export interface NewOriginal {
  blob: Blob;
  mimeType: ImageMimeType;
  fileName?: string;
}

/**
 * Where listings and their photos live: on the API (`RemoteListingRepository`). The listings store and every image
 * reader go through this port, which tests replace with fakes.
 */
export interface ListingRepository {
  list(): Promise<ListingSummary[]>;
  get(listingId: string): Promise<ListingDocument | null>;
  /** A new listing whose original is `original`, named `name`. */
  create(name: string, original: NewOriginal): Promise<ListingDocument>;
  /** Persists the document's user-editable state (the remote adapter sends only what changed). */
  save(doc: ListingDocument): Promise<void>;
  delete(listingId: string): Promise<void>;
  /** A copy of the listing: the original photo and the seller's choices (photo packs are generated again). */
  duplicate(listingId: string, name: string): Promise<ListingDocument | null>;
  readImage(listingId: string, bucket: ImageBucket, assetId: string): Promise<Blob | null>;
  /** Removes an image's bytes (and its thumbnail); the caller updates the document. */
  deleteImage(listingId: string, asset: Pick<ImageAsset, "id" | "kind">): Promise<void>;
}
