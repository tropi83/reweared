/** Whether "Create the listing" can run, what it will skip, and the first reason it cannot. Pure. */
export interface ListingReadinessInput {
  hasImage: boolean;
  hasSelection: boolean;
  photosReady: boolean;
  textReady: boolean;
}
export type ListingBlocker = "composer.needImage" | "listing.needCategory" | "listing.needProviders";
export type ListingPart = "photos" | "text";
export interface ListingReadiness {
  canCreate: boolean;
  blocker: ListingBlocker | null;
  skipped: ListingPart[];
}

export function listingReadiness(input: ListingReadinessInput): ListingReadiness {
  if (!input.hasImage) return { canCreate: false, blocker: "composer.needImage", skipped: [] };
  if (!input.hasSelection) return { canCreate: false, blocker: "listing.needCategory", skipped: [] };
  const skipped: ListingPart[] = [...(input.photosReady ? [] : (["photos"] as const)), ...(input.textReady ? [] : (["text"] as const))];
  if (skipped.length === 2) return { canCreate: false, blocker: "listing.needProviders", skipped };
  return { canCreate: true, blocker: null, skipped };
}
