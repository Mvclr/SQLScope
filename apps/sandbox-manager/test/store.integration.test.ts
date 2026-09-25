import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newSandboxId, type SandboxId } from '../src/domain/sandbox.js';
import { IllegalTransitionError } from '../src/domain/state-machine.js';
import { migrate } from '../src/store/migrate.js';
import { PgStore } from '../src/store/pg-store.js';
import { startStateDatabase, type StateDatabase } from './support/state-database.js';

let db: StateDatabase;
let store: PgStore;
const t0 = new Date('2026-09-25T12:00:00Z');
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

beforeAll(async () => {
  db = await startStateDatabase();
  store = new PgStore(db.pool);
});
afterAll(() => db?.stop());
beforeEach(() => db.reset());

async function request(requestId: string, seconds = 0) {
  return store.create({
    id: newSandboxId(),
    requestId,
    seed: 'create table t (id int);',
    labPassword: 'secret',
    ttlSeconds: 600,
    idleSeconds: 60,
    now: at(seconds),
  });
}

async function transitions(id: SandboxId) {
  const result = await db.pool.query(
    'select from_status, to_status, reason from sandbox_transitions where sandbox_id = $1 order by seq',
    [id],
  );
  return result.rows;
}

describe('PgStore', () => {
  it('migrates once', async () => {
    expect(await migrate(db.pool)).toEqual([]);
  });

  it('makes creation idempotent on the request id', async () => {
    const first = await request('req-1');
    const again = await request('req-1');
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.record.id).toBe(first.record.id);
    expect(await transitions(first.record.id)).toEqual([
      { from_status: null, to_status: 'PENDING', reason: 'requested' },
    ]);
  });

  it('moves only from the expected status, and logs each move', async () => {
    const { record } = await request('req-1');
    const [admitted] = await store.admit(4, at(1), 60);
    expect(admitted).toMatchObject({ id: record.id, status: 'PROVISIONING' });
    // The hard deadline covers the lifetime asked for plus the provisioning timeout.
    expect(admitted!.expiresAt).toEqual(at(1 + 600 + 60));

    const ready = await store.transition(record.id, 'PROVISIONING', 'READY', {
      at: at(2),
      patch: { readyAt: at(2), host: 'sqlscope-t2-x', port: 5432 },
    });
    expect(ready).toMatchObject({
      status: 'READY',
      readyAt: at(2),
      host: 'sqlscope-t2-x',
      port: 5432,
    });

    // A second writer that still believes the sandbox is provisioning loses the race.
    expect(
      await store.transition(record.id, 'PROVISIONING', 'FAILED', { at: at(3), reason: 'x' }),
    ).toBeNull();

    expect(await transitions(record.id)).toEqual([
      { from_status: null, to_status: 'PENDING', reason: 'requested' },
      { from_status: 'PENDING', to_status: 'PROVISIONING', reason: 'admitted' },
      { from_status: 'PROVISIONING', to_status: 'READY', reason: null },
    ]);
  });

  it('refuses transitions outside the state machine', async () => {
    const { record } = await request('req-1');
    await expect(
      store.transition(record.id, 'PENDING', 'ACTIVE', { at: at(1) }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('erases the secrets when a sandbox ends', async () => {
    const { record } = await request('req-1');
    const ended = await store.transition(record.id, 'PENDING', 'DESTROYED', {
      at: at(5),
      reason: 'released',
    });
    expect(ended).toMatchObject({
      seed: null,
      labPassword: null,
      endedAt: at(5),
      endReason: 'released',
    });
  });

  it('records the failure reason', async () => {
    const { record } = await request('req-1');
    const failed = await store.transition(record.id, 'PENDING', 'FAILED', {
      at: at(1),
      reason: 'provision-failed',
    });
    expect(failed).toMatchObject({ failure: 'provision-failed', endReason: null });
  });

  it('admits in request order up to the global limit', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await request(`req-${i}`, i)).record.id);

    expect(await store.queuePosition(ids[3]!)).toBe(4);
    const admitted = await store.admit(2, at(10), 60);
    expect(admitted.map((r) => r.id)).toEqual(ids.slice(0, 2));
    expect(await store.queuePosition(ids[3]!)).toBe(2);
    expect(await store.queuePosition(ids[0]!)).toBeNull();

    // Full: nothing more until a slot frees up.
    expect(await store.admit(2, at(11), 60)).toEqual([]);
    await store.transition(ids[0]!, 'PROVISIONING', 'FAILED', { at: at(12), reason: 'x' });
    expect((await store.admit(2, at(13), 60)).map((r) => r.id)).toEqual([ids[2]]);
  });

  it('keeps sandboxes being torn down in their slot', async () => {
    const { record } = await request('req-1');
    await request('req-2', 1);
    await store.admit(1, at(2), 60);
    await store.transition(record.id, 'PROVISIONING', 'EXPIRING', {
      at: at(3),
      reason: 'released',
    });
    await store.transition(record.id, 'EXPIRING', 'DESTROYING', { at: at(4) });
    expect(await store.admit(1, at(5), 60)).toEqual([]);
  });

  it('never admits past the limit under concurrent admission', async () => {
    for (let i = 0; i < 10; i++) await request(`req-${i}`, i);
    const rounds = await Promise.all(Array.from({ length: 8 }, () => store.admit(3, at(20), 60)));
    expect(rounds.flat()).toHaveLength(3);
    expect((await store.countByStatus()).PROVISIONING).toBe(3);
  });

  it('renews the heartbeat of an active sandbox only', async () => {
    const { record } = await request('req-1');
    expect(await store.touch(record.id, at(1))).toBeNull();
    await store.admit(1, at(1), 60);
    await store.transition(record.id, 'PROVISIONING', 'READY', { at: at(2) });
    await store.transition(record.id, 'READY', 'ACTIVE', {
      at: at(3),
      patch: { lastHeartbeatAt: at(3) },
    });
    expect(await store.touch(record.id, at(9))).toMatchObject({ lastHeartbeatAt: at(9) });
  });

  it('lists live sandboxes and counts them by status', async () => {
    const a = await request('req-1');
    const b = await request('req-2', 1);
    await store.transition(b.record.id, 'PENDING', 'DESTROYED', { at: at(2), reason: 'released' });
    expect((await store.listLive()).map((r) => r.id)).toEqual([a.record.id]);
    expect(await store.countByStatus()).toMatchObject({ PENDING: 1, DESTROYED: 1, READY: 0 });
  });
});
