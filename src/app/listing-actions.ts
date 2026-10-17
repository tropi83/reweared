import { toGenerationError } from "@aiv/domain/models";
import { t } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { saveFile } from "@/infrastructure/image/export";
import { createLogger } from "@/lib/logger";
import { assertSafeId } from "@aiv/domain/lib/ids";
import { currentRoute, navigate } from "./router";
import { getServices } from "./services";
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

/**
 * Saves the listing as a ZIP (document, texts, original and generated photos) built by the server: the seller's data,
 * portable. Failures are shown as a toast; cancelling the save dialog is silent.
 */
export async function exportListing(listingId: string): Promise<void> {
  try {
    const archive = await getServices().api.client.get<Blob>(`/api/v1/listings/${assertSafeId(listingId)}/export`);
    if (await saveFile(archive, `listing-${listingId}.zip`)) toast.info(t("listings.exported"));
  } catch (err) {
    const error = toGenerationError(err);
    log.warn("export failed", error.code);
    toast.error(errorMessage(error));
  }
}
