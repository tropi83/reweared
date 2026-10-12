import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createId } from "@aiv/domain/lib/ids";
import { creditBalance, creditLedger, imageAsset, listing, user } from "../src/db/schema";
import { checkCreditDrift, sweepOrphans } from "../src/maintenance/maintenance";
import { objectKey } from "../src/storage/keys";
import { S3ObjectStore } from "../src/storage/s3-object-store";
import { openTestDatabase, truncateAll } from "./db-harness";

const database = openTestDatabase();
const { db } = database;
const store = new S3ObjectStore(inject("s3"));
const quiet = { info() {}, warn() {}, error() {} };
afterAll(async () => {
  store.close();
  await database.close();
});
beforeEach(async () => {
  await truncateAll(database);
  // deletePrefix refuses a prefix this wide (a safety net); the test clears the bucket object by object.
  for await (const page of store.list("u/")) for (const o of page) await store.delete(o.key);
});

describe("orphan sweep", () => {
  it("deletes old objects no row points to and keeps referenced or recent ones", async () => {
    await db.insert(user).values({ id: "u_alice", name: "A", email: "a@example.test", emailVerified: true });
    const listingId = createId("lst");
    await db.insert(listing).values({ id: listingId, userId: "u_alice", name: "L" });
    const kept = createId("img");
    const keptKey = objectKey("u_alice", listingId, "original", kept, "jpg");
    const keptThumb = objectKey("u_alice", listingId, "thumbnail", kept, "webp");
    await db.insert(imageAsset).values({
      id: kept,
      listingId,
      userId: "u_alice",
      kind: "original",
      mimeType: "image/jpeg",
      width: 1,
      height: 1,
      byteSize: 1,
      objectKey: keptKey,
      thumbKey: keptThumb,
      sha256: "0",
    });
    const orphan = objectKey("u_alice", listingId, "generation", createId("img"), "png");
    const ghostUser = objectKey("u_gone", createId("lst"), "original", createId("img"), "jpg");
    for (const key of [keptKey, keptThumb, orphan, ghostUser]) await store.put(key, Buffer.from("x"), "image/png");
    await store.put("u/u_alice/notes.txt", Buffer.from("x"), "text/plain");

    // Everything is "recent" for a sweep that requires a day of age: nothing goes.
    expect((await sweepOrphans(db, store, quiet, { minAgeMs: 24 * 3600 * 1000 })).deleted).toBe(0);

    const report = await sweepOrphans(db, store, quiet, { minAgeMs: 0, now: new Date(Date.now() + 1000) });
    expect(report).toEqual({ scanned: 5, deleted: 2, unknown: 1 });
    expect(await store.get(keptKey)).not.toBeNull();
    expect(await store.get(keptThumb)).not.toBeNull();
    expect(await store.get(orphan)).toBeNull();
    expect(await store.get(ghostUser)).toBeNull();
    expect(await store.get("u/u_alice/notes.txt")).not.toBeNull();
  });
});

describe("credit drift check", () => {
  it("reports balances that differ from their ledger, without changing them", async () => {
    for (const id of ["u_ok", "u_bad"]) await db.insert(user).values({ id, name: id, email: `${id}@example.test`, emailVerified: true });
    await db.insert(creditBalance).values([
      { userId: "u_ok", balance: 60 },
      { userId: "u_bad", balance: 75 },
    ]);
    for (const userId of ["u_ok", "u_bad"])
      await db.insert(creditLedger).values({ id: randomUUID(), userId, delta: 60, reason: "grant", idempotencyKey: `grant:${userId}:x` });
    const report = await checkCreditDrift(db, quiet);
    expect(report).toEqual({ checked: 2, drifting: [{ userId: "u_bad", balance: 75, ledger: 60 }] });
    expect((await db.select().from(creditBalance)).find((b) => b.userId === "u_bad")?.balance).toBe(75);
  });
});
