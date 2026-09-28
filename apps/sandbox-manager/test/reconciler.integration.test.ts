import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newSandboxId, type SandboxId } from '../src/domain/sandbox.js';
import { Scheduler } from '../src/lifecycle/scheduler.js';
import { silentLog } from '../src/log.js';
import { InMemoryProvider } from '../src/provider/in-memory-provider.js';
import {
  DESTROY_MAX_ATTEMPTS,
  Reconciler,
  type ReconcilerEvents,
} from '../src/reconcile/reconciler.js';
import { PgStore } from '../src/store/pg-store.js';
import { startStateDatabase, type StateDatabase } from './support/state-database.js';

let db: StateDatabase;
let store: PgStore;
let provider: InMemoryProvider;
let scheduler: Scheduler;
let reconciler: Reconciler;
let events: { name: keyof ReconcilerEvents; arg?: unknown }[];

let now = Date.parse('2026-09-25T12:00:00Z');
const clock = () => new Date(now);
const advance = (seconds: number) => (now += seconds * 1000);

beforeAll(async () => {
  db = await startStateDatabase();
  store = new PgStore(db.pool);
});
afterAll(() => db?.stop());

function build(target: PgStore = store) {
  scheduler = new Scheduler(
    target,
    provider,
    { maxActive: 2, maxQueue: 10, provisionTimeoutSeconds: 60 },
    clock,
    silentLog,
  );
  reconciler = new Reconciler(
    target,
    provider,
    scheduler,
    { provisionTimeoutMs: 60_000, readyClaimMs: 120_000 },
    clock,
    silentLog,
  );
  events = [];
  const rec = (name: keyof ReconcilerEvents) => (arg?: unknown) => void events.push({ name, arg });
  reconciler.events = {
    pass: () => {},
    error: rec('error'),
    degraded: rec('degraded'),
    orphan: rec('orphan'),
    failed: rec('failed'),
  };
}

beforeEach(async () => {
  await db.reset();
  provider = new InMemoryProvider();
  build();
});

async function ready(requestId = 'req-1'): Promise<SandboxId> {
  const { record } = await scheduler.request({
    requestId,
    seed: '',
    ttlSeconds: 1800,
    idleSeconds: 600,
  });
  await scheduler.drain();
  return record.id;
}

async function status(id: SandboxId) {
  const record = await store.get(id);
  return { status: record?.status, endReason: record?.endReason, failure: record?.failure };
}

async function pass(seconds = 1) {
  advance(seconds);
  await reconciler.trigger();
}

describe('expiry', () => {
  it('tears down a ready sandbox nobody claims', async () => {
    const id = await ready();
    await pass(119);
    expect((await status(id)).status).toBe('READY');
    await pass(2);
    expect(await status(id)).toMatchObject({ status: 'DESTROYED', endReason: 'unclaimed' });
    expect(provider.has(id)).toBe(false);
  });

  it('tears down an active sandbox left idle', async () => {
    const id = await ready();
    await scheduler.heartbeat(id);
    await pass(599);
    expect((await status(id)).status).toBe('ACTIVE');
    await pass(2);
    expect(await status(id)).toMatchObject({ status: 'DESTROYED', endReason: 'idle' });
  });

  it('tears down at the hard deadline, heartbeats or not', async () => {
    const id = await ready();
    for (let elapsed = 0; elapsed < 1860; elapsed += 300) {
      await scheduler.heartbeat(id);
      await pass(300);
    }
    expect(await status(id)).toMatchObject({ status: 'DESTROYED', endReason: 'max-lifetime' });
  });

  it('finishes a release and admits the next in the queue', async () => {
    const a = await ready('req-a');
    await ready('req-b');
    const { record: c } = await scheduler.request({
      requestId: 'req-c',
      seed: '',
      ttlSeconds: 1800,
      idleSeconds: 600,
    });
    expect(c.status).toBe('PENDING');

    await scheduler.release(a);
    await pass();
    await scheduler.drain();
    expect(await status(a)).toMatchObject({ status: 'DESTROYED', endReason: 'released' });
    expect((await status(c.id)).status).toBe('READY');
  });
});

describe('convergence', () => {
  it('fails a sandbox whose container vanished and removes what is left', async () => {
    const id = await ready();
    const other = await ready('req-2');
    provider.lose(id);
    await pass();
    expect(await status(id)).toMatchObject({ status: 'FAILED', failure: 'container-lost' });
    expect(provider.has(id)).toBe(false);
    expect((await status(other)).status).toBe('READY');
    expect(events).toContainEqual({ name: 'failed', arg: 'container-lost' });
  });

  it('fails a sandbox whose container exited', async () => {
    const id = await ready();
    provider.crash(id);
    await pass();
    expect(await status(id)).toMatchObject({ status: 'FAILED', failure: 'container-lost' });
  });

  it('reaps orphans, container or network', async () => {
    const container = newSandboxId();
    const network = newSandboxId();
    provider.plant({ id: container, container: 'running', network: true, expiresAt: null });
    provider.plant({ id: network, container: null, network: true, expiresAt: null });
    await pass();
    expect(provider.has(container)).toBe(false);
    expect(provider.has(network)).toBe(false);
    expect(events).toEqual([
      { name: 'orphan', arg: 'container' },
      { name: 'orphan', arg: 'network' },
    ]);
  });

  it('fails a provisioning a crashed process left behind', async () => {
    // Admitted by a process that died before the container was ready: nobody here runs it.
    const { record } = await store.create({
      id: newSandboxId(),
      requestId: 'req-1',
      seed: '',
      labPassword: 'ab',
      ttlSeconds: 1800,
      idleSeconds: 600,
      now: clock(),
    });
    await store.admit(2, clock(), 60);
    provider.plant({ id: record.id, container: 'running', network: true, expiresAt: null });

    await pass(59);
    expect((await status(record.id)).status).toBe('PROVISIONING');
    await pass(2);
    expect(await status(record.id)).toMatchObject({ status: 'FAILED', failure: 'stuck' });
    expect(provider.has(record.id)).toBe(false);
  });

  it('retries a failing teardown, then gives up and reaps it as an orphan', async () => {
    const id = await ready();
    await scheduler.release(id);
    for (let attempt = 1; attempt <= DESTROY_MAX_ATTEMPTS; attempt++) {
      provider.failNext('destroy');
      await pass();
      expect((await store.get(id))?.destroyAttempts).toBe(attempt);
    }
    expect(await status(id)).toMatchObject({ status: 'FAILED', failure: 'destroy-failed' });
    expect(provider.has(id)).toBe(true);
    await pass();
    expect(provider.has(id)).toBe(false);
  });

  it('reaps by label alone while the state database is down', async () => {
    const down = Object.create(store) as PgStore;
    down.listLive = () => Promise.reject(new Error('connect ECONNREFUSED'));
    build(down);

    const expired = newSandboxId();
    const current = newSandboxId();
    provider.plant({ id: expired, container: 'running', network: true, expiresAt: clock() });
    provider.plant({
      id: current,
      container: 'running',
      network: true,
      expiresAt: new Date(now + 60_000),
    });
    await pass();
    expect(provider.has(expired)).toBe(false);
    expect(provider.has(current)).toBe(true);
    expect(events.map((e) => e.name)).toEqual(['degraded', 'orphan']);
  });

  it('survives a pass that cannot list the runtime', async () => {
    const id = await ready();
    provider.failNext('list');
    await pass(200);
    expect(events).toEqual([{ name: 'error', arg: undefined }]);
    expect((await status(id)).status).toBe('READY');
    await pass();
    expect(await status(id)).toMatchObject({ status: 'DESTROYED', endReason: 'unclaimed' });
  });

  it('never runs two passes at once', async () => {
    const id = await ready();
    advance(200);
    await Promise.all([reconciler.trigger(), reconciler.trigger(), reconciler.trigger()]);
    expect(provider.destroyed.filter((d) => d === id)).toHaveLength(1);
  });

  it('reattaches the clients of live sandboxes, and only of those', async () => {
    const claimed = await ready('req-claimed');
    await scheduler.heartbeat(claimed);
    const unclaimed = await ready('req-unclaimed');
    const released = await ready('req-released');
    await scheduler.release(released);
    await pass();
    expect(provider.reattached.sort()).toEqual([claimed, unclaimed].sort());
  });
});
