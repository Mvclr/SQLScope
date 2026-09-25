import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Scheduler } from '../src/lifecycle/scheduler.js';
import { silentLog, systemClock } from '../src/log.js';
import { InMemoryProvider } from '../src/provider/in-memory-provider.js';
import { PgStore } from '../src/store/pg-store.js';
import { startStateDatabase, type StateDatabase } from './support/state-database.js';

const TOKEN = 't'.repeat(40);
const config = loadConfig({
  NODE_ENV: 'test',
  SANDBOX_MANAGER_TOKEN: TOKEN,
  STATE_DATABASE_URL: 'postgres://unused@localhost/unused',
  MAX_ACTIVE_SANDBOXES: '2',
  MAX_QUEUE: '2',
  SANDBOX_MAX_MINUTES: '30',
  SANDBOX_IDLE_MINUTES: '10',
  SEED_MAX_BYTES: '1024',
});

let db: StateDatabase;
let store: PgStore;
let provider: InMemoryProvider;
let scheduler: Scheduler;
let app: FastifyInstance;

beforeAll(async () => {
  db = await startStateDatabase();
  store = new PgStore(db.pool);
});
afterAll(() => db?.stop());

beforeEach(async () => {
  await db.reset();
  provider = new InMemoryProvider();
  scheduler = new Scheduler(
    store,
    provider,
    { maxActive: 2, maxQueue: 2, provisionTimeoutSeconds: 60 },
    systemClock,
    silentLog,
  );
  app = buildApp({ config, checks: [], store, scheduler });
});

const auth = { authorization: `Bearer ${TOKEN}` };

async function create(requestId: string, body: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/sandboxes',
    headers: auth,
    payload: { requestId, seed: 'create table t (id int);', ...body },
  });
}

async function get(id: string) {
  return app.inject({ method: 'GET', url: `/sandboxes/${id}`, headers: auth });
}

// Bodyless calls carry the JSON content type anyway, as HTTP clients commonly send it:
// fetch sends a bodyless POST with Content-Length 0 and a bodyless DELETE with none.
const json = { ...auth, 'content-type': 'application/json' };

async function heartbeat(id: string) {
  return app.inject({
    method: 'POST',
    url: `/sandboxes/${id}/heartbeat`,
    headers: { ...json, 'content-length': '0' },
  });
}

async function release(id: string) {
  return app.inject({ method: 'DELETE', url: `/sandboxes/${id}`, headers: json });
}

describe('sandbox lifecycle', () => {
  it('provisions a request straight away when a slot is free', async () => {
    const created = await create('req-1');
    expect(created.statusCode).toBe(202);
    const { id } = created.json();
    expect(created.json()).toMatchObject({ status: 'PROVISIONING', queuePosition: null });

    await scheduler.drain();
    const ready = (await get(id)).json();
    expect(ready).toMatchObject({
      status: 'READY',
      connection: { host: `memory-${id}`, port: 5432, database: 'lab', user: 'lab' },
    });
    expect(ready.connection.password).toMatch(/^[0-9a-f]{48}$/);
    // The hard deadline is the lifetime asked for plus the provisioning timeout.
    const lifetime = Date.parse(ready.expiresAt) - Date.parse(ready.requestedAt);
    expect(lifetime).toBeGreaterThanOrEqual((30 * 60 + 60) * 1000);
  });

  it('answers a repeated request with the same sandbox', async () => {
    const first = (await create('req-1')).json();
    const again = await create('req-1');
    expect(again.statusCode).toBe(202);
    expect(again.json().id).toBe(first.id);
    await scheduler.drain();
    expect(provider.provisioned).toEqual([first.id]);
  });

  it('queues past the global limit and admits as slots free up', async () => {
    const open = provider.hold();
    const a = (await create('req-a')).json();
    const b = (await create('req-b')).json();
    const c = (await create('req-c')).json();
    const d = (await create('req-d')).json();
    expect(c).toMatchObject({ status: 'PENDING', queuePosition: 1 });
    expect(d).toMatchObject({ status: 'PENDING', queuePosition: 2 });

    // Queue full: refused, not queued.
    const refused = await create('req-e');
    expect(refused.statusCode).toBe(503);
    expect(refused.headers['retry-after']).toBe('30');

    expect((await get(b.id)).json().status).toBe('PROVISIONING');
    // A slot frees up — here the first one fails — and the next admission takes the head
    // of the queue.
    await store.transition(a.id, 'PROVISIONING', 'FAILED', { at: new Date(), reason: 'stuck' });
    await scheduler.admit();
    expect((await get(c.id)).json().status).toBe('PROVISIONING');
    expect((await get(d.id)).json()).toMatchObject({ status: 'PENDING', queuePosition: 1 });
    open();
    await scheduler.drain();
    expect((await get(c.id)).json().status).toBe('READY');
  });

  it('cleans up after a failed provisioning and keeps no secrets', async () => {
    provider.failNext('provision');
    const { id } = (await create('req-1')).json();
    await scheduler.drain();
    expect(provider.destroyed).toEqual([id]);
    expect(await store.get(id)).toMatchObject({
      status: 'FAILED',
      seed: null,
      labPassword: null,
    });
  });

  it('claims a ready sandbox with the first heartbeat and renews it with the next', async () => {
    const open = provider.hold();
    const { id } = (await create('req-1')).json();
    const early = await heartbeat(id);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ status: 'PROVISIONING' });
    open();
    await scheduler.drain();

    const claimed = await heartbeat(id);
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ status: 'ACTIVE', idleExpiresAt: expect.any(String) });
    const renewed = (await heartbeat(id)).json();
    expect(Date.parse(renewed.idleExpiresAt)).toBeGreaterThanOrEqual(
      Date.parse(claimed.json().idleExpiresAt),
    );
    expect((await heartbeat('t2_0123456789abcdef01234567')).statusCode).toBe(404);
  });

  it('drops a queued sandbox on release', async () => {
    await create('req-a');
    await create('req-b');
    const { id } = (await create('req-c')).json();
    const released = await release(id);
    expect(released.statusCode).toBe(204);
    expect(await store.get(id)).toMatchObject({ status: 'DESTROYED', endReason: 'released' });
    expect((await release(id)).statusCode).toBe(204);
    await scheduler.drain();
  });

  it('sends a ready sandbox to teardown on release, idempotently', async () => {
    const { id } = (await create('req-1')).json();
    await scheduler.drain();
    const released = await release(id);
    expect(released.statusCode).toBe(202);
    expect(released.json()).toMatchObject({
      status: 'EXPIRING',
      endReason: 'released',
      connection: null,
    });
    expect((await release(id)).statusCode).toBe(202);
    expect((await release('t2_0123456789abcdef01234567')).statusCode).toBe(404);
    expect((await get('not-an-id')).statusCode).toBe(404);
  });

  it('lets a release during provisioning win over the ready transition', async () => {
    const open = provider.hold();
    const { id } = (await create('req-1')).json();
    expect((await release(id)).json().status).toBe('EXPIRING');
    open();
    await scheduler.drain();
    // The container stays for the loop to reap; the record never comes back to READY.
    expect((await store.get(id))?.status).toBe('EXPIRING');
    expect(provider.has(id)).toBe(true);
  });

  it('validates the request', async () => {
    const tooLong = await create('req-1', { ttlSeconds: 30 * 60 + 1 });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error).toMatch(/ttlSeconds/);
    expect((await create('req-1', { seed: 'x'.repeat(1025) })).statusCode).toBe(400);
    expect((await create('req-1', { seed: 'select 1;\0' })).statusCode).toBe(400);
    expect((await create('bad id')).statusCode).toBe(400);
    expect((await create('req-1', { privileged: true })).statusCode).toBe(400);
    expect(provider.provisioned).toEqual([]);
  });
});
