import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Registry } from 'prom-client';
import type { Config } from './config.js';
import { evaluate, type HealthCheck } from './http/health.js';
import { sandboxRoutes, type SandboxRoutesDeps } from './http/routes.js';
import { bodyLimit } from './http/schemas.js';

const CHECK_TIMEOUT_MS = 2_000;

export interface AppDeps extends SandboxRoutesDeps {
  readonly config: Config;
  readonly checks: readonly HealthCheck[];
  /** The process logger; omitted in tests. */
  readonly logger?: FastifyBaseLogger;
  /** Served on /metrics when present. */
  readonly metrics?: Registry;
}

/** The HTTP surface, built from its dependencies so tests can drive it with `inject()`. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const app = Fastify({
    ...(deps.logger ? { loggerInstance: deps.logger } : { logger: false }),
    bodyLimit: bodyLimit(config),
  });

  // Clients often send `Content-Type: application/json` on every call, bodyless heartbeat
  // and DELETE included, and Fastify answers an empty JSON body with 400. Without a body
  // there is nothing to parse, so the header is dropped rather than the request.
  app.addHook('onRequest', async (request) => {
    const { headers } = request;
    const bodyless =
      (headers['content-length'] ?? '0') === '0' && headers['transfer-encoding'] === undefined;
    if (bodyless) delete headers['content-type'];
  });

  /** Liveness: the process is up. Touches no dependency, so it never flaps with them. */
  app.get('/health', async () => ({ status: 'ok' }));

  /** Readiness: every dependency answers. 503 tells the orchestrator to hold traffic. */
  app.get('/health/ready', async (_request, reply) => {
    const readiness = await evaluate(deps.checks, CHECK_TIMEOUT_MS);
    return reply.code(readiness.status === 'ready' ? 200 : 503).send(readiness);
  });

  // Like the health routes, reachable only on the internal network: no port is published.
  const { metrics } = deps;
  if (metrics) {
    app.get('/metrics', async (_request, reply) =>
      reply.type(metrics.contentType).send(await metrics.metrics()),
    );
  }

  // Registered as a plugin so the token hook covers these routes and not the health ones.
  app.register(sandboxRoutes, deps);

  return app;
}
