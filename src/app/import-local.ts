import type { ListingCopy, ListingDocument, ListingSummary } from "@aiv/domain/models";
import type { StorageProvider } from "@/infrastructure/storage";
import type { ListingRepository } from "./ports/listing-repository";

/** Local meta key: local listing id → the listing created from it in the account, and whether its details are in. */
const IMPORTED_KEY = "imported_listings";

type Imported = Record<string, { remoteId: string; done: boolean }>;

/**
 * One-time import of the listings kept on this device into the account (API mode). Per listing: its original photo,
 * name, category, brand, mannequin choice, copy, and "to post" when the original was marked. Generated photos are not
 * imported (the server accepts originals only; they can be generated again). The device's copy is left untouched.
 * Progress is recorded after each listing, so an interrupted import resumes where it stopped.
 */
export class LocalImport {
  constructor(
    private readonly local: StorageProvider,
    private readonly remote: ListingRepository,
  ) {}

  /** The device's listings not imported yet. */
  async pending(): Promise<ListingSummary[]> {
    const [summaries, imported] = await Promise.all([this.local.listListings(), this.imported()]);
    return summaries.filter((s) => !imported[s.id]?.done);
  }

  /** Imports one listing; `false` when it has no original photo left to import (it is then marked done). */
  async importOne(localId: string): Promise<boolean> {
    const source = await this.local.getListing(localId);
    const original = source?.listing.originalImageId ? source.images[source.listing.originalImageId] : undefined;
    const blob = original ? await this.local.readImage(localId, original.kind, original.id) : null;
    if (!source || !original || !blob) {
      await this.record(localId, { remoteId: "", done: true });
      return false;
    }
    // Resumed after a failure between the upload and the details: finish that listing instead of creating another.
    const started = (await this.imported())[localId];
    let created = started?.remoteId ? await this.remote.get(started.remoteId) : null;
    if (!created) {
      created = await this.remote.create(source.listing.name, {
        blob,
        mimeType: original.mimeType,
        ...(original.fileName ? { fileName: original.fileName } : {}),
      });
      await this.record(localId, { remoteId: created.listing.id, done: false });
    }
    await this.remote.save(withMetadata(created, source, original.id));
    await this.record(localId, { remoteId: created.listing.id, done: true });
    return true;
  }

  private async imported(): Promise<Imported> {
    return (await this.local.readMeta<Imported>(IMPORTED_KEY)) ?? {};
  }

  private async record(localId: string, state: Imported[string]): Promise<void> {
    await this.local.writeMeta(IMPORTED_KEY, { ...(await this.imported()), [localId]: state });
  }
}

/** The server's limits on a copy (`listingCopy` in @aiv/contracts); text edited on the device may be longer. */
export function fitCopy(copy: ListingCopy): ListingCopy {
  return {
    ...copy,
    title: copy.title.slice(0, 200),
    description: copy.description.slice(0, 5000),
    keywords: copy.keywords.slice(0, 20).map((k) => k.slice(0, 40)),
    ...(copy.brand !== undefined ? { brand: copy.brand.slice(0, 60) } : {}),
    ...(copy.color !== undefined ? { color: copy.color.slice(0, 40) } : {}),
    provider: copy.provider.slice(0, 40),
    model: copy.model.slice(0, 120),
  };
}

function withMetadata(created: ListingDocument, source: ListingDocument, originalId: string): ListingDocument {
  const { name, category, brand, useMannequin, copy } = source.listing;
  const newOriginal = created.listing.originalImageId;
  return {
    ...created,
    listing: {
      ...created.listing,
      name,
      ...(category ? { category } : {}),
      ...(brand ? { brand } : {}),
      ...(useMannequin ? { useMannequin } : {}),
      ...(copy ? { copy: fitCopy(copy) } : {}),
    },
    toPost: source.toPost.includes(originalId) && newOriginal ? [newOriginal] : created.toPost,
  };
}
