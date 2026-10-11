import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { signIn, startHarness, verifiedUser, type Harness } from "./app-harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

async function bearer(email: string): Promise<{ authorization: string }> {
  await verifiedUser(h, email);
  return { authorization: `Bearer ${String((await signIn(h, email)).headers["set-auth-token"])}` };
}

/** A multipart body built by Node's own FormData, as a browser would send it. */
async function multipart(bytes: Buffer, fileName: string, type = "image/jpeg"): Promise<{ payload: Buffer; contentType: string }> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), fileName);
  const request = new Request("http://form.local", { method: "POST", body: form });
  return { payload: Buffer.from(await request.arrayBuffer()), contentType: request.headers.get("content-type") ?? "" };
}

async function upload(headers: Record<string, string>, listingId: string, bytes: Buffer, fileName = "shirt.jpg") {
  const { payload, contentType } = await multipart(bytes, fileName);
  return h.app.inject({ method: "POST", url: `/api/v1/listings/${listingId}/images`, headers: { ...headers, "content-type": contentType }, payload });
}

async function newListing(headers: Record<string, string>): Promise<string> {
  return (await h.app.inject({ method: "POST", url: "/api/v1/listings", headers, payload: {} })).json().listing.id as string;
}

const photo = () =>
  sharp({ create: { width: 1200, height: 900, channels: 3, background: "#3366cc" } })
    .withExif({ IFD0: { Make: "PhoneMaker" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 2400/100" } })
    .jpeg()
    .toBuffer();

describe("image upload and delivery", () => {
  it("stores an upright, metadata-free original and a thumbnail, and serves both", async () => {
    const alice = await bearer("alice@example.test");
    const listingId = await newListing(alice);
    const res = await upload(alice, listingId, await photo(), "../../IMG_0001.JPG");
    expect(res.statusCode).toBe(201);
    const asset = res.json();
    expect(asset).toMatchObject({ listingId, kind: "original", mimeType: "image/jpeg", width: 1200, height: 900, fileName: "IMG_0001.JPG" });

    const doc = (await h.app.inject({ method: "GET", url: `/api/v1/listings/${listingId}`, headers: alice })).json();
    expect(doc.listing.originalImageId).toBe(asset.id);
    expect(doc.images[asset.id]).toEqual(asset);

    const full = await h.app.inject({ method: "GET", url: `/api/v1/images/${asset.id}`, headers: alice });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("image/jpeg");
    expect(full.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(full.headers["x-content-type-options"]).toBe("nosniff");
    expect(full.rawPayload.includes(Buffer.from("PhoneMaker"))).toBe(false);
    expect((await sharp(full.rawPayload).metadata()).exif).toBeUndefined();

    const thumb = await h.app.inject({ method: "GET", url: `/api/v1/images/${asset.id}?variant=thumb`, headers: alice });
    expect(thumb.headers["content-type"]).toBe("image/webp");
    expect(thumb.rawPayload.length).toBeLessThan(full.rawPayload.length);
    const meta = await sharp(thumb.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([512, 384]);

    const cached = await h.app.inject({ method: "GET", url: `/api/v1/images/${asset.id}`, headers: { ...alice, "if-none-match": String(full.headers.etag) } });
    expect(cached.statusCode).toBe(304);
    expect(cached.rawPayload.length).toBe(0);
  });

  it("refuses files that are not images, oversized files and other users' listings", async () => {
    const alice = await bearer("alice@example.test");
    const bob = await bearer("bob@example.test");
    const listingId = await newListing(alice);

    const text = await upload(alice, listingId, Buffer.from("just text, not a jpeg"), "photo.jpg");
    expect(text.statusCode).toBe(415);
    expect(text.json().code).toBe("UNSUPPORTED_MEDIA_TYPE");

    const huge = await upload(alice, listingId, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024)]));
    expect(huge.statusCode).toBe(413);
    expect(huge.json().code).toBe("PAYLOAD_TOO_LARGE");

    const foreign = await upload(bob, listingId, await photo());
    expect(foreign.statusCode).toBe(404);

    const anonymous = await upload({}, listingId, await photo());
    expect(anonymous.statusCode).toBe(401);

    const doc = (await h.app.inject({ method: "GET", url: `/api/v1/listings/${listingId}`, headers: alice })).json();
    expect(doc.images).toEqual({});
  });

  it("keeps images private and deletes them with every reference", async () => {
    const alice = await bearer("alice@example.test");
    const bob = await bearer("bob@example.test");
    const listingId = await newListing(alice);
    const first = (await upload(alice, listingId, await photo())).json().id as string;
    const second = (await upload(alice, listingId, await photo())).json().id as string;
    await h.app.inject({ method: "PATCH", url: `/api/v1/listings/${listingId}`, headers: alice, payload: { coverImageId: second, toPost: [first, second] } });

    expect((await h.app.inject({ method: "GET", url: `/api/v1/images/${first}`, headers: bob })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "DELETE", url: `/api/v1/images/${first}`, headers: bob })).statusCode).toBe(404);

    expect((await h.app.inject({ method: "DELETE", url: `/api/v1/images/${second}`, headers: alice })).statusCode).toBe(204);
    const doc = (await h.app.inject({ method: "GET", url: `/api/v1/listings/${listingId}`, headers: alice })).json();
    expect(doc.listing.coverImageId).toBeUndefined();
    expect(doc.listing.originalImageId).toBe(first);
    expect(doc.toPost).toEqual([first]);
    expect(Object.keys(doc.images)).toEqual([first]);
    expect((await h.app.inject({ method: "GET", url: `/api/v1/images/${second}`, headers: alice })).statusCode).toBe(404);
  });

  it("deleting the listing removes its images' bytes", async () => {
    const alice = await bearer("alice@example.test");
    const listingId = await newListing(alice);
    const id = (await upload(alice, listingId, await photo())).json().id as string;
    const [row] = await h.database.db.query.imageAsset.findMany({ where: (t, { eq }) => eq(t.id, id) });
    expect(await h.store.get(row!.objectKey)).not.toBeNull();
    await h.app.inject({ method: "DELETE", url: `/api/v1/listings/${listingId}`, headers: alice });
    expect(await h.store.get(row!.objectKey)).toBeNull();
    expect(await h.store.get(row!.thumbKey)).toBeNull();
  });
});
