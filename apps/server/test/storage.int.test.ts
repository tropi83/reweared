import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createId } from "@aiv/domain/lib/ids";
import { listingPrefix, objectKey, userPrefix } from "../src/storage/keys";
import { S3ObjectStore } from "../src/storage/s3-object-store";

const store = new S3ObjectStore(inject("s3"));
afterAll(() => store.close());

let user = "";
beforeEach(() => {
  // A fresh user prefix per test: objects never leak from one test to the next.
  user = `u${createId("img").slice(4, 20)}`;
});

async function read(key: string): Promise<{ text: string; contentType: string; contentLength: number } | null> {
  const found = await store.get(key);
  if (!found) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of found.body) chunks.push(chunk as Buffer);
  return { text: Buffer.concat(chunks).toString(), contentType: found.contentType, contentLength: found.contentLength };
}

describe("S3 object store (SeaweedFS)", () => {
  it("round-trips bytes with their content type and answers null for a missing key", async () => {
    const key = objectKey(user, createId("lst"), "original", createId("img"), "png");
    await store.put(key, Buffer.from("png bytes"), "image/png");
    expect(await read(key)).toEqual({ text: "png bytes", contentType: "image/png", contentLength: 9 });
    expect(await store.get(objectKey(user, createId("lst"), "original", createId("img"), "png"))).toBeNull();
  });

  it("deletes one object, and deleting a missing one is not an error", async () => {
    const key = objectKey(user, createId("lst"), "thumbnail", createId("img"), "webp");
    await store.put(key, Buffer.from([1]), "image/webp");
    await store.delete(key);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });

  it("deletes a listing prefix without touching the user's other listings", async () => {
    const [kept, removed] = [createId("lst"), createId("lst")];
    const keptKey = objectKey(user, kept, "original", createId("img"), "jpg");
    await store.put(keptKey, Buffer.from("keep"), "image/jpeg");
    for (let i = 0; i < 3; i++) await store.put(objectKey(user, removed, "generation", createId("img"), "png"), Buffer.from([i]), "image/png");
    expect(await store.deletePrefix(listingPrefix(user, removed))).toBe(3);
    expect((await read(keptKey))?.text).toBe("keep");
  });

  it("deletes more than one page (1000 objects) under a user prefix", async () => {
    const listingId = createId("lst");
    const keys = Array.from({ length: 1005 }, () => objectKey(user, listingId, "thumbnail", createId("img"), "webp"));
    for (let i = 0; i < keys.length; i += 50) await Promise.all(keys.slice(i, i + 50).map((k) => store.put(k, Buffer.from([0]), "image/webp")));
    expect(await store.deletePrefix(userPrefix(user))).toBe(1005);
    expect(await store.get(keys[1004]!)).toBeNull();
  });

  it("refuses to delete a prefix that is not a directory", async () => {
    await expect(store.deletePrefix("u")).rejects.toThrow(/non-directory/);
  });

  it("answers ping, and refuses wrong credentials", async () => {
    await expect(store.ping()).resolves.toBeUndefined();
    const wrong = new S3ObjectStore({ ...inject("s3"), secretAccessKey: "not-the-secret" });
    await expect(wrong.ping()).rejects.toBeTruthy();
    wrong.close();
  });
});
