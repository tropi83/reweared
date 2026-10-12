import type { Redis } from "ioredis";

/** What the user's apps receive live (SSE): ids, statuses and safe messages only — never a prompt or an image. */
export type JobEvent =
  | {
      type: "job";
      jobId: string;
      generationId: string;
      listingId: string;
      status: string;
      attempt: number;
      resultImageId?: string;
      error?: { code: string; message: string };
    }
  | { type: "generation"; generationId: string; listingId: string; status: string }
  | { type: "listing"; listingId: string }
  | { type: "credits"; balance: number };

export interface EventPublisher {
  publish(userId: string, event: JobEvent): Promise<void>;
}

/** Last events kept per user for `Last-Event-ID` replay. */
export const EVENTS_PER_USER = 1000;

export const eventStreamKey = (userId: string) => `events:${userId}`;

/** One capped Redis stream per user; the stream entry id is the SSE event id. */
export class RedisEventPublisher implements EventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(userId: string, event: JobEvent): Promise<void> {
    await this.redis.xadd(eventStreamKey(userId), "MAXLEN", "~", String(EVENTS_PER_USER), "*", "data", JSON.stringify(event));
  }
}
