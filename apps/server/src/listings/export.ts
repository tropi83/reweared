import { PassThrough, type Readable } from "node:stream";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { and, eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client";
import { imageAsset } from "../db/schema";
import type { ObjectStore } from "../storage/object-store";
import type { ListingDocument } from "@aiv/domain/models";

const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const safePart = (value: string | undefined, fallback: string) => (value && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : fallback);

/** The seller's text, as plain lines they can paste anywhere. */
function listingText(document: ListingDocument): string | undefined {
  const copy = document.listing.copy;
  if (!copy) return undefined;
  return [copy.title, "", copy.description, "", copy.keywords.map((k) => `#${k}`).join(" ")].join("\n").trim() + "\n";
}

/**
 * The listing as a ZIP: `listing.json` (the document), `listing.txt` (title and description when written), the original photo
 * and every generated photo. Photos are already compressed, so entries are stored. The archive is produced while the
 * objects are read one at a time and written to the response as it goes, with the socket's back-pressure respected,
 * so memory use does not grow with the number or size of photos.
 */
export function streamListingExport(deps: { db: Db; store: ObjectStore; log: FastifyBaseLogger }, userId: string, document: ListingDocument): Readable {
  const out = new PassThrough();
  const zip = new Zip((error, chunk, final) => {
    if (error) return void out.destroy(error);
    out.write(Buffer.from(chunk));
    if (final) out.end();
  });

  const drained = () => (out.writableNeedDrain ? new Promise<void>((resolve) => out.once("drain", resolve)) : Promise.resolve());
  const addSmall = (name: string, bytes: Uint8Array) => {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(bytes, true);
  };

  void (async () => {
    addSmall("listing.json", strToU8(JSON.stringify(document, null, 2)));
    const text = listingText(document);
    if (text) addSmall("listing.txt", strToU8(text));
    const rows = await deps.db
      .select()
      .from(imageAsset)
      .where(and(eq(imageAsset.listingId, document.listing.id), eq(imageAsset.userId, userId)));
    for (const row of rows) {
      const object = await deps.store.get(row.objectKey);
      if (!object) {
        deps.log.error({ imageId: row.id }, "export: image row without stored bytes, skipped");
        continue;
      }
      const job = row.jobId ? document.jobs[row.jobId] : undefined;
      const folder = row.kind === "original" ? "photos" : "photos/generated";
      const label = row.kind === "original" ? "original" : safePart(job?.shotId, "photo");
      const entry = new ZipPassThrough(`${folder}/${label}-${safePart(row.id, "image")}.${EXTENSION[row.mimeType] ?? "bin"}`);
      zip.add(entry);
      for await (const chunk of object.body as AsyncIterable<Buffer>) {
        entry.push(new Uint8Array(chunk));
        await drained();
      }
      entry.push(new Uint8Array(0), true);
    }
    zip.end();
  })().catch((error: unknown) => {
    deps.log.error({ err: error, userId }, "export failed midway");
    out.destroy(error instanceof Error ? error : new Error("export failed"));
  });

  return out;
}
