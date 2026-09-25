import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import {
  idleExpiresAt,
  isSandboxId,
  LAB_DATABASE,
  LAB_ROLE,
  type SandboxRecord,
} from '../domain/sandbox.js';
import { QueueFullError, type Scheduler } from '../lifecycle/scheduler.js';
import type { PgStore } from '../store/pg-store.js';
import { bearerAuth } from './auth.js';
import { createSandboxBody } from './schemas.js';

export interface SandboxRoutesDeps {
  readonly config: Config;
  readonly store: PgStore;
  readonly scheduler: Scheduler;
  /** Called after a release, so the teardown does not wait for the next tick. */
  readonly afterRelease?: () => void;
}

/** The internal API of ADR 0002, plus the heartbeat that claims and keeps a sandbox. */
export async function sandboxRoutes(app: FastifyInstance, deps: SandboxRoutesDeps) {
  const { config, store, scheduler } = deps;
  const body = createSandboxBody(config);

  app.addHook('onRequest', bearerAuth(config.SANDBOX_MANAGER_TOKEN));

  async function view(record: SandboxRecord) {
    const usable = record.status === 'READY' || record.status === 'ACTIVE';
    return {
      id: record.id,
      status: record.status,
      queuePosition: record.status === 'PENDING' ? await store.queuePosition(record.id) : null,
      requestedAt: record.requestedAt,
      readyAt: record.readyAt,
      expiresAt: record.expiresAt,
      idleExpiresAt: idleExpiresAt(record),
      endReason: record.endReason,
      failure: record.failure,
      connection:
        usable && record.host !== null && record.port !== null && record.labPassword !== null
          ? {
              host: record.host,
              port: record.port,
              database: LAB_DATABASE,
              user: LAB_ROLE,
              password: record.labPassword,
            }
          : null,
    };
  }

  function sandboxId(params: unknown): string | null {
    const id = (params as { id?: string }).id ?? '';
    return isSandboxId(id) ? id : null;
  }

  app.post('/sandboxes', async (request, reply) => {
    const parsed = body.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    }
    try {
      const { record } = await scheduler.request(parsed.data);
      return reply.code(202).send(await view(record));
    } catch (error) {
      if (!(error instanceof QueueFullError)) throw error;
      return reply.code(503).header('retry-after', '30').send({ error: error.message });
    }
  });

  app.get('/sandboxes/:id', async (request, reply) => {
    const id = sandboxId(request.params);
    const record = id ? await store.get(id) : null;
    if (record === null) return reply.code(404).send({ error: 'sandbox not found' });
    return view(record);
  });

  app.post('/sandboxes/:id/heartbeat', async (request, reply) => {
    const id = sandboxId(request.params);
    if (id === null) return reply.code(404).send({ error: 'sandbox not found' });
    const result = await scheduler.heartbeat(id);
    switch (result.outcome) {
      case 'not-found':
        return reply.code(404).send({ error: 'sandbox not found' });
      case 'conflict':
        return reply
          .code(409)
          .send({ error: `sandbox is ${result.record.status}`, ...(await view(result.record)) });
      case 'ok':
        return view(result.record);
    }
  });

  app.delete('/sandboxes/:id', async (request, reply) => {
    const id = sandboxId(request.params);
    const record = id ? await scheduler.release(id) : null;
    if (record === null) return reply.code(404).send({ error: 'sandbox not found' });
    // Nothing left to tear down, whether this call ended it or an earlier one did.
    if (record.status === 'DESTROYED' || record.status === 'FAILED') return reply.code(204).send();
    deps.afterRelease?.();
    return reply.code(202).send(await view(record));
  });
}
