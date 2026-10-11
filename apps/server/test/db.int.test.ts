import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createId } from "@aiv/domain/lib/ids";
import { imageAsset, listing, recipe, user, userSettings } from "../src/db/schema";
import { openTestDatabase, truncateAll } from "./db-harness";

const database = openTestDatabase();
const { db } = database;
afterAll(() => database.close());
beforeEach(() => truncateAll(database));

async function seedUser(id: string): Promise<void> {
  await db.insert(user).values({ id, name: "Seller", email: `${id}@example.test`, emailVerified: true });
}

async function seedListingWithImage(userId: string): Promise<{ listingId: string; imageId: string }> {
  const listingId = createId("lst");
  const imageId = createId("img");
  await db.insert(listing).values({ id: listingId, userId, name: "Blue shirt" });
  await db.insert(imageAsset).values({
    id: imageId,
    listingId,
    userId,
    kind: "original",
    mimeType: "image/jpeg",
    width: 800,
    height: 600,
    byteSize: 1234,
    objectKey: `u/${userId}/l/${listingId}/original/${imageId}.jpg`,
    thumbKey: `u/${userId}/l/${listingId}/thumbnail/${imageId}.webp`,
    sha256: "0".repeat(64),
  });
  return { listingId, imageId };
}

describe("database schema", () => {
  it("has every table the migrations create", async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(result.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["account", "image_asset", "listing", "recipe", "session", "user", "user_settings", "verification"]),
    );
  });

  it("removes a user's listings, images, settings and recipes with the account", async () => {
    await seedUser("u_alice");
    await seedUser("u_bob");
    await seedListingWithImage("u_alice");
    const bob = await seedListingWithImage("u_bob");
    const now = new Date().toISOString();
    await db
      .insert(userSettings)
      .values({ userId: "u_alice", settings: { locale: "fr", theme: "dark", vintedAutomationAcknowledged: false, defaultAspectRatio: "original" } });
    await db.insert(recipe).values({
      id: createId("rcp"),
      userId: "u_alice",
      data: { id: "x", name: "R", promptTemplate: "p", category: "custom", createdAt: now, updatedAt: now },
    });

    await db.delete(user).where(eq(user.id, "u_alice"));

    expect(await db.select().from(listing)).toEqual([expect.objectContaining({ id: bob.listingId, userId: "u_bob" })]);
    expect(await db.select().from(imageAsset)).toEqual([expect.objectContaining({ id: bob.imageId })]);
    expect(await db.select().from(userSettings)).toEqual([]);
    expect(await db.select().from(recipe)).toEqual([]);
  });

  it("removes a listing's images with the listing", async () => {
    await seedUser("u_alice");
    const { listingId } = await seedListingWithImage("u_alice");
    await db.delete(listing).where(eq(listing.id, listingId));
    expect(await db.select().from(imageAsset)).toEqual([]);
  });

  it("refuses unknown image kinds and MIME types at the database level", async () => {
    await seedUser("u_alice");
    const { listingId } = await seedListingWithImage("u_alice");
    const bad = (overrides: Record<string, string>) =>
      db.execute(
        sql`insert into image_asset (id, listing_id, user_id, kind, mime_type, width, height, byte_size, object_key, thumb_key, sha256)
            values (${createId("img")}, ${listingId}, 'u_alice', ${overrides.kind ?? "original"}, ${overrides.mime ?? "image/png"}, 1, 1, 1, 'k', 't', 's')`,
      );
    await expect(bad({ kind: "avatar" })).rejects.toMatchObject({ cause: { constraint: "image_asset_kind_check" } });
    await expect(bad({ mime: "image/svg+xml" })).rejects.toMatchObject({ cause: { constraint: "image_asset_mime_check" } });
  });
});
