import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RedisEventPublisher } from "../src/queue/events";
import { signIn, startHarness, verifiedUser, type Harness } from "./app-harness";

let h: Harness;
let base = "";
let events: RedisEventPublisher;
beforeAll(async () => {
  h = await startHarness();
  base = await h.app.listen({ port: 0, host: "127.0.0.1" });
  events = new RedisEventPublisher(h.runs.redis);
});
afterAll(() => h.close());
beforeEach(() => h.reset());

async function account(email: string): Promise<{ authorization: string; userId: string }> {
  await verifiedUser(h, email);
  const res = await signIn(h, email);
  return { authorization: `Bearer ${String(res.headers["set-auth-token"])}`, userId: res.json().user.id as string };
}

interface Received {
  id: string;
  data: { type: string; listingId?: string };
}

/** Opens the stream and collects events until `count` arrived (or the timeout), then closes it. */
async function collect(
  authorization: string,
  count: number,
  opts: { lastEventId?: string; afterOpen?: () => Promise<void>; timeoutMs?: number } = {},
): Promise<Received[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5_000);
  const res = await fetch(`${base}/api/v1/events`, {
    headers: { authorization, ...(opts.lastEventId ? { "last-event-id": opts.lastEventId } : {}) },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const received: Received[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let opened = false;
  try {
    while (received.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (!opened && buffer.includes("retry:")) {
        opened = true;
        await opts.afterOpen?.();
      }
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const id = block.match(/^id: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (id && data) received.push({ id, data: JSON.parse(data) });
      }
    }
  } catch {
    // aborted by the timeout
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return received;
}

describe("GET /api/v1/events", () => {
  it("delivers the user's new events, in order", async () => {
    const alice = await account("alice@example.test");
    const got = await collect(alice.authorization, 2, {
      afterOpen: async () => {
        await events.publish(alice.userId, { type: "listing", listingId: "lst_00000000000000a1" });
        await events.publish(alice.userId, { type: "listing", listingId: "lst_00000000000000a2" });
      },
    });
    expect(got.map((e) => e.data.listingId)).toEqual(["lst_00000000000000a1", "lst_00000000000000a2"]);
  });

  it("replays exactly what was missed after Last-Event-ID", async () => {
    const alice = await account("alice@example.test");
    for (const n of [1, 2, 3]) await events.publish(alice.userId, { type: "listing", listingId: `lst_00000000000000b${n}` });
    const [first] = await collect(alice.authorization, 1, { lastEventId: "0-0" });
    const rest = await collect(alice.authorization, 2, { lastEventId: first!.id });
    expect(rest.map((e) => e.data.listingId)).toEqual(["lst_00000000000000b2", "lst_00000000000000b3"]);
  });

  it("never sends another user's events", async () => {
    const alice = await account("alice@example.test");
    const bob = await account("bob@example.test");
    await events.publish(alice.userId, { type: "listing", listingId: "lst_00000000000000c1" });
    const got = await collect(bob.authorization, 1, { lastEventId: "0-0", timeoutMs: 1_000 });
    expect(got).toEqual([]);
  });

  it("refuses anonymous clients and a fourth open stream", async () => {
    expect((await fetch(`${base}/api/v1/events`)).status).toBe(401);
    const alice = await account("alice@example.test");
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const open = await Promise.all(
      controllers.map((c) => fetch(`${base}/api/v1/events`, { headers: { authorization: alice.authorization }, signal: c.signal })),
    );
    expect(open.map((r) => r.status)).toEqual([200, 200, 200]);
    const fourth = await fetch(`${base}/api/v1/events`, { headers: { authorization: alice.authorization } });
    expect(fourth.status).toBe(429);
    for (const c of controllers) c.abort();
    // Closed streams free their slots.
    await new Promise((r) => setTimeout(r, 300));
    const again = new AbortController();
    const reopened = await fetch(`${base}/api/v1/events`, { headers: { authorization: alice.authorization }, signal: again.signal });
    expect(reopened.status).toBe(200);
    again.abort();
  });
});
