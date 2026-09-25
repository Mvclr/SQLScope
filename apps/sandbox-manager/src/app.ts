import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { evaluate, type HealthCheck } from './http/health.js';

const CHECK_TIMEOUT_MS = 2_000;

export interface AppDeps {
  readonly config: Config;
  readonly checks: readonly HealthCheck[];
}

/** The HTTP surface, built from its dependencies so tests can drive it with `inject()`. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
  });

  /** Liveness: the process is up. Touches no dependency, so it never flaps with them. */
  app.get('/health', async () => ({ status: 'ok' }));

  /** Readiness: every dependency answers. 503 tells the orchestrator to hold traffic. */
  app.get('/health/ready', async (_request, reply) => {
    const readiness = await evaluate(deps.checks, CHECK_TIMEOUT_MS);
    return reply.code(readiness.status === 'ready' ? 200 : 503).send(readiness);
  });

  return app;
}
