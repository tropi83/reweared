import { toGenerationError } from "@/domain/models";
import { t } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { createLogger } from "@/lib/logger";
import { currentRoute, navigate } from "./router";
import { useListingSetupStore } from "./stores/listing-setup-store";
import { useListingsStore } from "./stores/listings-store";
import { usePublishStore } from "./stores/publish-store";
import { toast } from "./stores/toast-store";

const log = createLogger("listing-actions");

/**
 * Deletes a listing from this device — never anything on Vinted. Everything bound to it stops first:
 * a Vinted session opened for it, a generation run (the store cancels the queue when it is the open
 * listing). The workspace leaves the listing before its files go, so nothing renders a document that no
 * longer exists. Callers confirm with the user before calling this.
 */
export async function deleteListing(listingId: string): Promise<void> {
  const listings = useListingsStore.getState();
  if (usePublishStore.getState().session.listingId === listingId) await usePublishStore.getState().finish();
  if (listings.current?.listing.id === listingId) {
    useListingSetupStore.getState().cancelListingRun();
    if (currentRoute().name === "listing") navigate({ name: "home" });
  }
  try {
    await listings.remove(listingId);
    toast.info(t("listings.deleted"));
  } catch (err) {
    const error = toGenerationError(err);
    log.warn("delete failed", error.code);
    toast.error(errorMessage(error));
  }
}
