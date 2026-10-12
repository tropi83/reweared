import { assertSafeId } from "@aiv/domain/lib/ids";

/** Where an image's bytes go: the full image of an import or a generation, or its WebP thumbnail. */
export type ObjectBucket = "original" | "generation" | "thumbnail";
export type ObjectExtension = "png" | "jpg" | "webp";

/** Better Auth user ids are random alphanumerics; anything else is refused before it can shape a key. */
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function assertUserId(userId: string): string {
  if (!USER_ID_PATTERN.test(userId)) throw new Error("Invalid user identifier");
  return userId;
}

/** Every object of a user lives under this prefix (account deletion removes it). */
export function userPrefix(userId: string): string {
  return `u/${assertUserId(userId)}/`;
}

/** Every object of a listing lives under this prefix (listing deletion removes it). */
export function listingPrefix(userId: string, listingId: string): string {
  return `${userPrefix(userId)}l/${assertSafeId(listingId)}/`;
}

/** `u/<userId>/l/<listingId>/<bucket>/<assetId>.<ext>` — built only from checked ids, never from request text. */
export function objectKey(userId: string, listingId: string, bucket: ObjectBucket, assetId: string, extension: ObjectExtension): string {
  return `${listingPrefix(userId, listingId)}${bucket}/${assertSafeId(assetId)}.${extension}`;
}
