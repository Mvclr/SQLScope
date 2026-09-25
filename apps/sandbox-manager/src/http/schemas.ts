import { z } from 'zod';
import type { Config } from '../config.js';

/**
 * Body of `POST /sandboxes`. Lifetimes default to, and may not exceed, the maximums in the
 * config; the seed is bounded in bytes, not characters.
 */
export function createSandboxBody(config: Config) {
  const maxTtl = config.SANDBOX_MAX_MINUTES * 60;
  const maxIdle = config.SANDBOX_IDLE_MINUTES * 60;
  return z.strictObject({
    requestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, 'requestId: 1–128 of [A-Za-z0-9._:-]'),
    seed: z
      .string()
      // The seed reaches the container as an environment variable, which cannot hold NUL.
      .refine((seed) => !seed.includes('\0'), 'seed must not contain NUL characters')
      .refine(
        (seed) => Buffer.byteLength(seed, 'utf8') <= config.SEED_MAX_BYTES,
        `seed exceeds ${config.SEED_MAX_BYTES} bytes`,
      )
      .default(''),
    ttlSeconds: z.int().positive().max(maxTtl).default(maxTtl),
    idleSeconds: z.int().positive().max(maxIdle).default(maxIdle),
  });
}

/** Worst case for JSON: every byte of the seed escaped as `\u00XX`. */
export function bodyLimit(config: Config): number {
  return config.SEED_MAX_BYTES * 6 + 4_096;
}
