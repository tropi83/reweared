/** Whether "Create the listing" can run, and the first reason it cannot. Pure. */
export interface ListingReadinessInput {
  hasImage: boolean;
  hasSelection: boolean;
  /** The account's balance and what the run costs; absent while unknown (the server checks again). */
  credits?: { balance: number; cost: number };
}
export type ListingBlocker = "composer.needImage" | "listing.needCategory" | "listing.needCredits";
export interface ListingReadiness {
  canCreate: boolean;
  blocker: ListingBlocker | null;
}

export function listingReadiness(input: ListingReadinessInput): ListingReadiness {
  if (!input.hasImage) return { canCreate: false, blocker: "composer.needImage" };
  if (!input.hasSelection) return { canCreate: false, blocker: "listing.needCategory" };
  if (input.credits && input.credits.balance < input.credits.cost) return { canCreate: false, blocker: "listing.needCredits" };
  return { canCreate: true, blocker: null };
}
