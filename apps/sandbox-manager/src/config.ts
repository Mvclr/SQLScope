import { z } from 'zod';

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

/**
 * The Docker bridge address pool fits about 30 networks, and every sandbox gets its own
 * (ADR 0002, "Ajustes da implementação"). The cap leaves room for the stack's own networks.
 */
export const MAX_SANDBOXES_CEILING = 20;

/**
 * Tokens that live in the repository — the `.env.example` placeholders — so the service
 * boots locally. Whoever holds the token can start containers on the host, so a
 * production process refuses to run with one.
 */
const KNOWN_TOKENS = new Set([
  'dev-only-sandbox-manager-token-change-me',
  'replace-with-at-least-32-random-characters',
]);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Bearer token the API presents. The service is internal, but not unauthenticated. */
  SANDBOX_MANAGER_TOKEN: z.string().min(32),
  /** The manager's own database: sandbox records and their transitions, nothing else. */
  STATE_DATABASE_URL: z.url(),
  /** The Docker socket proxy. Never the socket itself (ADR 0002). */
  DOCKER_HOST: z.url().default('http://docker-socket-proxy:2375'),
  /**
   * Label value that marks the containers and networks this manager owns. Reconciliation
   * only ever touches its own, so tests and a local `pnpm dev` can share one daemon.
   */
  MANAGER_INSTANCE: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .default('sqlscope'),

  /** Image of each T2 sandbox. Must already be on the host: the proxy blocks pulls. */
  T2_IMAGE: z.string().min(1).default('postgres:18-alpine'),
  /** Memory limit, which the data tmpfs counts against, so it must exceed T2_DISK_MB. */
  T2_MEMORY_MB: positiveInt(384),
  /** Size of the tmpfs that holds the cluster: the sandbox's disk quota. */
  T2_DISK_MB: positiveInt(128),
  T2_CPUS: z.coerce.number().positive().max(16).default(0.5),
  T2_PIDS: positiveInt(128),

  MAX_ACTIVE_SANDBOXES: z.coerce.number().int().positive().max(MAX_SANDBOXES_CEILING).default(4),
  /** Requests waiting beyond this are refused with 503 instead of queued. */
  MAX_QUEUE: positiveInt(50),
  /** No sandbox outlives this, used or not. Also the most a request may ask for. */
  SANDBOX_MAX_MINUTES: positiveInt(30),
  /** An active sandbox without a heartbeat for this long is destroyed. */
  SANDBOX_IDLE_MINUTES: positiveInt(10),
  /** A ready sandbox nobody claims with a first heartbeat within this is destroyed. */
  READY_CLAIM_SECONDS: positiveInt(120),
  PROVISION_TIMEOUT_SECONDS: positiveInt(60),
  RECONCILE_INTERVAL_MS: positiveInt(5_000),
  /**
   * Containers joined to every sandbox network, so they can reach the sandboxes — the
   * API, once a lab uses T2. Comma-separated names.
   */
  SANDBOX_ATTACH_CONTAINERS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    )
    .pipe(z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/))),
  SEED_MAX_BYTES: positiveInt(65_536),
});

const validated = schema.superRefine((config, ctx) => {
  if (config.NODE_ENV === 'production' && KNOWN_TOKENS.has(config.SANDBOX_MANAGER_TOKEN)) {
    ctx.addIssue({
      code: 'custom',
      path: ['SANDBOX_MANAGER_TOKEN'],
      message: 'SANDBOX_MANAGER_TOKEN is a known default; set a unique random value in production.',
    });
  }
  // The cluster lives on a tmpfs, and tmpfs pages are charged to the container's memory:
  // a disk as large as the memory limit would let a full disk starve PostgreSQL itself.
  if (config.T2_DISK_MB >= config.T2_MEMORY_MB) {
    ctx.addIssue({
      code: 'custom',
      path: ['T2_DISK_MB'],
      message: 'T2_DISK_MB must be smaller than T2_MEMORY_MB: the data tmpfs counts as memory.',
    });
  }
});

export type Config = z.infer<typeof validated>;

/** Validates the environment once at startup; a misconfigured process refuses to boot. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = validated.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
