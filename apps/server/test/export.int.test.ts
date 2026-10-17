import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
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

async function listingWithPhoto(headers: Record<string, string>): Promise<{ listingId: string; imageId: string }> {
  const listingId = (await h.app.inject({ method: "POST", url: "/api/v1/listings", headers, payload: { name: "Blue shirt" } })).json().listing.id as string;
  const bytes = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#3366cc" } })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), "shirt.jpg");
  const request = new Request("http://form.local", { method: "POST", body: form });
  const res = await h.app.inject({
    method: "POST",
    url: `/api/v1/listings/${listingId}/images`,
    headers: { ...headers, "content-type": request.headers.get("content-type") ?? "" },
    payload: Buffer.from(await request.arrayBuffer()),
  });
  expect(res.statusCode).toBe(201);
  return { listingId, imageId: res.json().id as string };
}

describe("listing export", () => {
  it("returns a ZIP with the document and the original photo, byte for byte", async () => {
    const alice = await bearer("alice@example.test");
    const { listingId, imageId } = await listingWithPhoto(alice);
    const res = await h.app.inject({ method: "GET", url: `/api/v1/listings/${listingId}/export`, headers: alice });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="listing-${listingId}.zip"`);
    expect(res.headers["cache-control"]).toBe("no-store");

    const files = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(files).sort()).toEqual(["listing.json", `photos/original-${imageId}.jpg`]);
    const document = JSON.parse(strFromU8(files["listing.json"] as Uint8Array));
    expect(document.listing.id).toBe(listingId);
    const original = await h.app.inject({ method: "GET", url: `/api/v1/images/${imageId}`, headers: alice });
    expect(Buffer.from(files[`photos/original-${imageId}.jpg`] as Uint8Array).equals(original.rawPayload)).toBe(true);
  });

  it("is scoped to the owner: another account gets a 404 and nothing", async () => {
    const alice = await bearer("alice@example.test");
    const bob = await bearer("bob@example.test");
    const { listingId } = await listingWithPhoto(alice);
    const res = await h.app.inject({ method: "GET", url: `/api/v1/listings/${listingId}/export`, headers: bob });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).not.toBe("application/zip");
    expect((await h.app.inject({ method: "GET", url: `/api/v1/listings/${listingId}/export` })).statusCode).toBe(401);
  });
});
