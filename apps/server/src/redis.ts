import { Redis } from "ioredis";

export function connectRedis(url: string): Redis {
  // Commands fail fast instead of queueing forever while Redis is down; readiness reports it.
  return new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
}

/**
 * Fixed-window counter for Better Auth's `rateLimit.customStorage`: one atomic INCR + EXPIRE per request,
 * so concurrent api processes share the same limits. `window` is in seconds.
 */
const CONSUME = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

export function redisRateLimitStorage(redis: Redis, prefix = "rl:auth:") {
  return {
    async consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }> {
      const [count, ttl] = (await redis.eval(CONSUME, 1, `${prefix}${key}`, String(Math.max(1, Math.ceil(rule.window))))) as [number, number];
      return count <= rule.max ? { allowed: true, retryAfter: null } : { allowed: false, retryAfter: Math.max(1, ttl) };
    },
  };
}
