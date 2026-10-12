import type { Redis } from "ioredis";

/**
 * Daily guard on the platform's Cloudflare spend (estimated neurons, UTC day like Cloudflare's own reset). The api
 * refuses new image runs that would cross the budget (503 PROVIDER_BUDGET_EXHAUSTED, no credit reserved); the
 * worker adds the estimate of every image it produced.
 */
export class NeuronBudget {
  constructor(
    private readonly redis: Redis,
    private readonly dailyBudget: number,
  ) {}

  private key(now: Date): string {
    return `budget:cloudflare:neurons:${now.toISOString().slice(0, 10)}`;
  }

  async spent(now = new Date()): Promise<number> {
    return Number((await this.redis.get(this.key(now))) ?? 0);
  }

  /** Whether `estimate` more neurons still fit in today's budget. */
  async allows(estimate: number, now = new Date()): Promise<boolean> {
    if (estimate <= 0) return true;
    return (await this.spent(now)) + estimate <= this.dailyBudget;
  }

  async record(neurons: number, now = new Date()): Promise<void> {
    if (neurons <= 0) return;
    const key = this.key(now);
    await this.redis
      .multi()
      .incrby(key, Math.round(neurons))
      .expire(key, 2 * 24 * 3600)
      .exec();
  }
}
