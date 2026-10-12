import type { FastifyInstance, FastifyReply, onRequestAsyncHookHandler } from "fastify";
import type { Redis } from "ioredis";
import { sessionUser } from "../http/auth-guard";
import { HttpError } from "../http/errors";
import { eventStreamKey } from "../queue/events";

/** Open event streams allowed per user (each holds a Redis connection blocked on XREAD). */
const MAX_STREAMS_PER_USER = 3;
const HEARTBEAT_MS = 15_000;
const STREAM_ID = /^\d{1,20}-\d{1,20}$/;

type Entries = Array<[string, string[]]>;

function write(reply: FastifyReply, entries: Entries): string | undefined {
  let last: string | undefined;
  for (const [id, fields] of entries) {
    const data = fields[fields.indexOf("data") + 1];
    if (data === undefined) continue;
    reply.raw.write(`id: ${id}\nevent: message\ndata: ${data}\n\n`);
    last = id;
  }
  return last;
}

/**
 * `GET /api/v1/events` — Server-Sent Events of the signed-in user's jobs, generations and listings, from the
 * user's Redis stream. A reconnecting client sends `Last-Event-ID` and gets exactly what it missed (up to the
 * last ~1000 events), then live events. Comment heartbeats keep proxies from closing an idle stream.
 */
export function registerEventRoutes(app: FastifyInstance, redis: Redis, guard: onRequestAsyncHookHandler): void {
  app.get("/api/v1/events", { onRequest: guard }, async (req, reply) => {
    const userId = sessionUser(req).id;
    const counterKey = `sse:open:${userId}`;
    const open = await redis.incr(counterKey);
    await redis.expire(counterKey, 3600);
    if (open > MAX_STREAMS_PER_USER) {
      await redis.decr(counterKey);
      throw new HttpError(429, "RATE_LIMITED", "Too many open event streams.");
    }
    const lastEventId = req.headers["last-event-id"];
    let cursor = typeof lastEventId === "string" && STREAM_ID.test(lastEventId) ? lastEventId : "$";

    const key = eventStreamKey(userId);
    if (cursor === "$") {
      // Start after the newest event that exists now — before the client learns the stream is open.
      const [latest] = (await redis.xrevrange(key, "+", "-", "COUNT", 1)) as Entries;
      cursor = latest?.[0] ?? "0-0";
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write("retry: 3000\n\n");

    const reader = redis.duplicate();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      reader.disconnect();
      void redis.decr(counterKey);
    };
    req.raw.on("close", close);

    try {
      while (!closed) {
        const result = (await reader.xread("BLOCK", HEARTBEAT_MS, "STREAMS", key, cursor)) as Array<[string, Entries]> | null;
        if (closed) break;
        if (!result) {
          reply.raw.write(": ping\n\n");
          continue;
        }
        for (const [, entries] of result) cursor = write(reply, entries) ?? cursor;
      }
    } catch (error) {
      // A disconnect interrupts the blocking read; anything else is logged.
      if (!closed) req.log.warn({ err: error }, "event stream stopped");
    } finally {
      close();
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });
}
