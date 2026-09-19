import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** SQLScope's own database. Never receives user SQL (concept §24). */
  CONTROL_DATABASE_URL: z.url(),
  /** T1 cluster, as the non-superuser provisioner role (ADR 0001). */
  SANDBOX_DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
});

export type Config = z.infer<typeof schema>;

export const CONFIG = Symbol('CONFIG');

/** Validates the environment once at startup; a misconfigured process refuses to boot. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
