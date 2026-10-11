import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createId } from "@aiv/domain/lib/ids";
import { imageAsset } from "../src/db/schema";
import { objectKey } from "../src/storage/keys";
import { signIn, startHarness, verifiedUser, type Harness } from "./app-harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

/** A verified account, authenticated with a bearer token like the desktop and phone apps. */
async function account(email: string): Promise<{ headers: { authorization: string }; userId: string }> {
  await verifiedUser(h, email);
  const res = await signIn(h, email);
  return { headers: { authorization: `Bearer ${String(res.headers["set-auth-token"])}` }, userId: res.json().user.id as string };
}

function call(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, headers: Record<string, string>, payload?: unknown) {
  return h.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
}

async function addImage(userId: string, listingId: string, kind: "original" | "generation" = "original"): Promise<string> {
  const id = createId("img");
  const objectKeyFor = objectKey(userId, listingId, kind, id, "jpg");
  await h.database.db.insert(imageAsset).values({
    id,
    listingId,
    userId,
    kind,
    mimeType: "image/jpeg",
    width: 10,
    height: 10,
    byteSize: 4,
    objectKey: objectKeyFor,
    thumbKey: objectKey(userId, listingId, "thumbnail", id, "webp"),
    sha256: "0".repeat(64),
  });
  await h.store.put(objectKeyFor, Buffer.from("jpeg"), "image/jpeg");
  return id;
}

describe("listings", () => {
  it("creates, lists, reads, patches and deletes a listing", async () => {
    const alice = await account("alice@example.test");
    const created = await call("POST", "/api/v1/listings", alice.headers, { name: "  Blue shirt " });
    expect(created.statusCode).toBe(201);
    const id = created.json().listing.id as string;
    expect(created.json()).toMatchObject({ listing: { name: "Blue shirt", useMannequin: false }, images: {}, generations: {}, jobs: {}, toPost: [] });

    const image = await addImage(alice.userId, id);
    const patched = await call("PATCH", `/api/v1/listings/${id}`, alice.headers, {
      category: { categoryId: "men", subcategoryId: "clothing" },
      brand: "Levi's",
      useMannequin: true,
      coverImageId: image,
      toPost: [image, image],
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().listing).toMatchObject({ brand: "Levi's", useMannequin: true, coverImageId: image, category: { categoryId: "men" } });
    expect(patched.json().toPost).toEqual([image]);
    expect(patched.json().images[image]).toMatchObject({ kind: "original", mimeType: "image/jpeg" });

    const cleared = await call("PATCH", `/api/v1/listings/${id}`, alice.headers, { brand: null, category: null });
    expect(cleared.json().listing.brand).toBeUndefined();
    expect(cleared.json().listing.category).toBeUndefined();

    const list = await call("GET", "/api/v1/listings", alice.headers);
    expect(list.json()).toEqual([expect.objectContaining({ id, name: "Blue shirt", coverImageId: image, imageCount: 0 })]);

    expect((await call("DELETE", `/api/v1/listings/${id}`, alice.headers)).statusCode).toBe(204);
    expect((await call("GET", `/api/v1/listings/${id}`, alice.headers)).statusCode).toBe(404);
    expect(await h.store.get(objectKey(alice.userId, id, "original", image, "jpg"))).toBeNull();
  });

  it("lists the most recently updated first and names an unnamed listing", async () => {
    const alice = await account("alice@example.test");
    const first = (await call("POST", "/api/v1/listings", alice.headers, {})).json().listing.id as string;
    const second = (await call("POST", "/api/v1/listings", alice.headers, { name: "Second" })).json().listing.id as string;
    await call("PATCH", `/api/v1/listings/${first}`, alice.headers, { name: "First, renamed" });
    const names = (await call("GET", "/api/v1/listings", alice.headers)).json().map((l: { id: string; name: string }) => l.id);
    expect(names).toEqual([first, second]);
    expect((await call("GET", `/api/v1/listings/${second}`, alice.headers)).json().listing.name).toBe("Second");
    const untitled = await call("POST", "/api/v1/listings", alice.headers, {});
    expect(untitled.json().listing.name).toBe("Untitled");
  });

  it("refuses invalid patches", async () => {
    const alice = await account("alice@example.test");
    const id = (await call("POST", "/api/v1/listings", alice.headers, {})).json().listing.id as string;
    const otherListing = (await call("POST", "/api/v1/listings", alice.headers, {})).json().listing.id as string;
    const foreignImage = await addImage(alice.userId, otherListing);
    for (const body of [{ userId: "someone" }, { brand: "x".repeat(61) }, { toPost: [foreignImage] }, { coverImageId: createId("img") }, { name: "" }]) {
      const res = await call("PATCH", `/api/v1/listings/${id}`, alice.headers, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
    expect((await call("GET", "/api/v1/listings/not-an-id", alice.headers)).statusCode).toBe(400);
  });

  it("deleting a listing leaves the user's other listings and their objects alone", async () => {
    const alice = await account("alice@example.test");
    const [a, b] = [
      (await call("POST", "/api/v1/listings", alice.headers, {})).json().listing.id as string,
      (await call("POST", "/api/v1/listings", alice.headers, {})).json().listing.id as string,
    ];
    const kept = await addImage(alice.userId, b);
    await addImage(alice.userId, a);
    await call("DELETE", `/api/v1/listings/${a}`, alice.headers);
    expect((await call("GET", `/api/v1/listings/${b}`, alice.headers)).json().images[kept]).toBeDefined();
    expect(await h.store.get(objectKey(alice.userId, b, "original", kept, "jpg"))).not.toBeNull();
  });
});

describe("another user's data", () => {
  it("answers 404 on every route and changes nothing", async () => {
    const alice = await account("alice@example.test");
    const bob = await account("bob@example.test");
    const listingId = (await call("POST", "/api/v1/listings", alice.headers, { name: "Alice's" })).json().listing.id as string;
    const image = await addImage(alice.userId, listingId);
    const recipeId = createId("rcp");
    const now = new Date().toISOString();
    const recipe = { id: recipeId, name: "Alice's recipe", promptTemplate: "p", category: "custom", createdAt: now, updatedAt: now };
    expect((await call("PUT", `/api/v1/recipes/${recipeId}`, alice.headers, recipe)).statusCode).toBe(200);

    const attempts: Array<[string, string, unknown?]> = [
      ["GET", `/api/v1/listings/${listingId}`],
      ["PATCH", `/api/v1/listings/${listingId}`, { name: "Bob was here" }],
      ["PATCH", `/api/v1/listings/${listingId}`, { toPost: [image] }],
      ["DELETE", `/api/v1/listings/${listingId}`],
      ["PUT", `/api/v1/recipes/${recipeId}`, { ...recipe, name: "Bob's now" }],
      ["DELETE", `/api/v1/recipes/${recipeId}`],
    ];
    for (const [method, url, body] of attempts) {
      const res = await call(method as "GET", url, bob.headers, body);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    }
    expect((await call("GET", "/api/v1/listings", bob.headers)).json()).toEqual([]);
    expect((await call("GET", "/api/v1/recipes", bob.headers)).json()).toEqual([]);

    const doc = (await call("GET", `/api/v1/listings/${listingId}`, alice.headers)).json();
    expect(doc.listing.name).toBe("Alice's");
    expect(doc.toPost).toEqual([]);
    expect((await call("GET", "/api/v1/recipes", alice.headers)).json()).toEqual([recipe]);
    expect(await h.store.get(objectKey(alice.userId, listingId, "original", image, "jpg"))).not.toBeNull();
  });

  it("requires a session on every route", async () => {
    for (const [method, url] of [
      ["GET", "/api/v1/listings"],
      ["POST", "/api/v1/listings"],
      ["GET", `/api/v1/listings/${createId("lst")}`],
      ["GET", "/api/v1/me/settings"],
      ["GET", "/api/v1/recipes"],
    ]) {
      expect((await call(method as "GET", url!, {})).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe("settings", () => {
  it("starts from the defaults, is replaced as a whole and never stores credentials", async () => {
    const alice = await account("alice@example.test");
    expect((await call("GET", "/api/v1/me/settings", alice.headers)).json()).toEqual({
      locale: "en",
      theme: "system",
      vintedAutomationAcknowledged: false,
      defaultAspectRatio: "original",
    });
    const next = {
      locale: "fr",
      theme: "dark",
      vintedAutomationAcknowledged: true,
      defaultAspectRatio: "4:5",
      mannequin: { build: "M", pose: "sitting", skinTone: "olive" },
    };
    expect((await call("PUT", "/api/v1/me/settings", alice.headers, next)).json()).toEqual(next);
    expect((await call("GET", "/api/v1/me/settings", alice.headers)).json()).toEqual(next);
    expect((await call("PUT", "/api/v1/me/settings", alice.headers, { ...next, geminiApiKey: "AIzaFAKE" })).statusCode).toBe(400);
    const bob = await account("bob@example.test");
    expect((await call("GET", "/api/v1/me/settings", bob.headers)).json().locale).toBe("en");
  });
});

describe("recipes", () => {
  it("creates, replaces, lists and deletes custom recipes", async () => {
    const alice = await account("alice@example.test");
    const id = createId("rcp");
    const now = new Date().toISOString();
    const recipe = { id, name: "Flat lay", promptTemplate: "flat lay of {{subject}}", category: "custom", createdAt: now, updatedAt: now };
    expect((await call("PUT", `/api/v1/recipes/${id}`, alice.headers, recipe)).statusCode).toBe(200);
    expect((await call("PUT", `/api/v1/recipes/${id}`, alice.headers, { ...recipe, name: "Flat lay v2" })).statusCode).toBe(200);
    expect((await call("GET", "/api/v1/recipes", alice.headers)).json()).toEqual([{ ...recipe, name: "Flat lay v2" }]);
    expect((await call("PUT", `/api/v1/recipes/${createId("rcp")}`, alice.headers, recipe)).statusCode).toBe(400);
    expect((await call("PUT", `/api/v1/recipes/${id}`, alice.headers, { ...recipe, builtIn: true })).statusCode).toBe(400);
    expect((await call("DELETE", `/api/v1/recipes/${id}`, alice.headers)).statusCode).toBe(204);
    expect((await call("DELETE", `/api/v1/recipes/${id}`, alice.headers)).statusCode).toBe(404);
  });
});
