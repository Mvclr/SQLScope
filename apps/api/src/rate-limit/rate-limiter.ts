import type { Redis } from 'ioredis';

export interface RateLimitOutcome {
  readonly allowed: boolean;
  /** Seconds until the current window resets. */
  readonly retryAfter: number;
}

/**
 * Fixed-window counters in Redis. Coarse, but enough to keep one client from monopolising
 * a public demo — and shared across API instances, unlike an in-memory counter.
 */
export class RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitOutcome> {
    const nowSeconds = this.now() / 1000;
    const window = Math.floor(nowSeconds / windowSeconds);
    const redisKey = `rl:${key}:${window}`;

    if (this.redis.status === 'wait') await this.redis.connect();
    const [[, count]] = (await this.redis
      .multi()
      .incr(redisKey)
      .expire(redisKey, windowSeconds * 2)
      .exec()) as [[Error | null, number]];

    return {
      allowed: count <= limit,
      retryAfter: Math.max(1, Math.ceil((window + 1) * windowSeconds - nowSeconds)),
    };
  }
}
