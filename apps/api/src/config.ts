import { z } from 'zod';

const minutes = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /**
   * Proxies in front of the API whose `X-Forwarded-For` is trusted when deriving the
   * client address (Express `trust proxy`). 0 when clients connect directly.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** Mark the session cookie Secure. On for any deployment served over HTTPS. */
  COOKIE_SECURE: z.stringbool().default(false),
  /** Signs the session cookie and salts client address hashes. */
  SESSION_SECRET: z.string().min(32),
  /** SQLScope's own database. Never receives user SQL (concept §24). */
  CONTROL_DATABASE_URL: z.url(),
  /** T1 cluster, as the non-superuser provisioner role (ADR 0001). */
  SANDBOX_DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  /** A session unused for this long is destroyed. */
  SESSION_IDLE_MINUTES: minutes(20),
  /** No session outlives this, active or not. */
  SESSION_MAX_MINUTES: minutes(120),
  MAX_ACTIVE_SESSIONS: z.coerce.number().int().positive().default(100),
  MAX_SESSIONS_PER_CLIENT: z.coerce.number().int().positive().default(3),
  /** Size a sandbox database may grow to before its session is ended. */
  SANDBOX_QUOTA_MB: z.coerce.number().int().positive().default(64),
  STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  RESULT_MAX_ROWS: z.coerce.number().int().positive().default(1_000),
  RESULT_MAX_BYTES: z.coerce.number().int().positive().default(2_000_000),
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
