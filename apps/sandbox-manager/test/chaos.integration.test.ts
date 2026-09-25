import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newSandboxId, SLOT_STATUSES, type SandboxId } from '../src/domain/sandbox.js';
import { Scheduler } from '../src/lifecycle/scheduler.js';
import { silentLog, systemClock } from '../src/log.js';
import { resourceName } from '../src/provider/docker/container-spec.js';
import type { DockerProvider } from '../src/provider/docker/docker-provider.js';
import type { SandboxProvider } from '../src/provider/provider.js';
import { Reconciler } from '../src/reconcile/reconciler.js';
import { PgStore } from '../src/store/pg-store.js';
import {
  dockerProvider,
  killContainer,
  pauseContainer,
  randomInstance,
  reap,
  startSocketProxy,
  unpauseContainer,
} from './support/docker.js';
import { startStateDatabase, type StateDatabase } from './support/state-database.js';

/**
 * Chaos test of ADR 0002 against a real Docker daemon: break things the way production
 * would — containers killed behind the manager's back, a manager dying mid-provisioning,
 * rows gone, the state database down — and require convergence every time. The invariant
 * is the same after every scenario: the containers and networks labelled for this
 * instance are exactly those of the live records, and no record is stuck halfway.
 */

const MAX_ACTIVE = 4;
const PROVISION_TIMEOUT_S = 20;
const INTERVAL_MS = 500;

let db: StateDatabase;
let proxy: StartedTestContainer;
let store: PgStore;
let provider: DockerProvider;
const instance = randomInstance();
let manager: Manager;

interface Manager {
  readonly scheduler: Scheduler;
  stop(): Promise<void>;
}

/** One manager process: its scheduler and its loop. A new one shares nothing in memory. */
function startManager(runtime: SandboxProvider = provider): Manager {
  const scheduler = new Scheduler(
    store,
    runtime,
    { maxActive: MAX_ACTIVE, maxQueue: 50, provisionTimeoutSeconds: PROVISION_TIMEOUT_S },
    systemClock,
    silentLog,
  );
  const reconciler = new Reconciler(
    store,
    runtime,
    scheduler,
    // Long enough claim window that nothing expires on its own during a scenario.
    { provisionTimeoutMs: PROVISION_TIMEOUT_S * 1000, readyClaimMs: 3_600_000 },
    systemClock,
    silentLog,
  );
  reconciler.start(INTERVAL_MS);
  return { scheduler, stop: () => reconciler.stop() };
}

beforeAll(async () => {
  [db, proxy] = await Promise.all([startStateDatabase(), startSocketProxy()]);
  store = new PgStore(db.pool);
  provider = dockerProvider(proxy, instance, {
    provisionTimeoutMs: PROVISION_TIMEOUT_S * 1000,
  });
});

afterAll(async () => {
  await manager?.stop();
  if (provider) await reap(provider);
  await Promise.all([db?.stop(), proxy?.stop()]);
});

beforeEach(async () => {
  await manager?.stop();
  await reap(provider);
  await db.reset();
  manager = startManager();
});

async function request(ttlSeconds = 600): Promise<SandboxId> {
  const { record } = await manager.scheduler.request({
    requestId: randomBytes(8).toString('hex'),
    seed: 'create table t (id int);',
    ttlSeconds,
    idleSeconds: 600,
  });
  return record.id;
}

async function statusOf(id: SandboxId) {
  return (await store.get(id))?.status;
}

async function eventually<T>(
  probe: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`did not converge: ${JSON.stringify(value)}`);
    }
    await sleep(250);
  }
}

async function ready(id: SandboxId) {
  await eventually(
    () => statusOf(id),
    (s) => s === 'READY',
  );
}

/** What is wrong right now; empty once converged. */
async function divergence(): Promise<string[]> {
  const observed = await provider.list();
  const live = await store.listLive();
  const problems: string[] = [];

  for (const record of live) {
    if (['PROVISIONING', 'EXPIRING', 'DESTROYING'].includes(record.status)) {
      problems.push(`${record.id} stuck in ${record.status}`);
    }
  }
  const holding = live.filter((r) => SLOT_STATUSES.includes(r.status)).length;
  if (live.some((r) => r.status === 'PENDING') && holding < MAX_ACTIVE) {
    problems.push('queue not admitted with slots free');
  }
  const owners = new Set(
    live.filter((r) => r.status === 'READY' || r.status === 'ACTIVE').map((r) => r.id),
  );
  for (const state of observed) {
    if (!owners.has(state.id)) problems.push(`${state.id} on the runtime without a live record`);
    else if (state.container !== 'running' || !state.network) {
      problems.push(`${state.id} incomplete on the runtime: ${JSON.stringify(state)}`);
    }
  }
  const seen = new Set(observed.map((s) => s.id));
  for (const id of owners) if (!seen.has(id)) problems.push(`${id} has no container`);
  return problems;
}

async function converged(timeoutMs = 90_000): Promise<void> {
  await eventually(divergence, (problems) => problems.length === 0, timeoutMs);
}

describe('chaos', { timeout: 300_000 }, () => {
  it('fails a sandbox whose container is killed, and leaves the others alone', async () => {
    const [victim, bystander] = [await request(), await request()];
    await Promise.all([ready(victim), ready(bystander)]);

    await killContainer(resourceName(victim));
    await eventually(
      () => store.get(victim),
      (r) => r?.status === 'FAILED',
    );
    expect((await store.get(victim))?.failure).toBe('container-lost');
    await eventually(
      () => provider.inspect(victim),
      (state) => state === null,
    );
    expect(await statusOf(bystander)).toBe('READY');
    expect(await provider.inspect(bystander)).toMatchObject({ container: 'running' });
    await converged();
  });

  it('reaps a labelled container nobody asked for', async () => {
    // Built with the loop stopped, which would otherwise reap it halfway through.
    await manager.stop();
    const stray = newSandboxId();
    await provider.provision({
      id: stray,
      seed: '',
      labPassword: randomBytes(16).toString('hex'),
      expiresAt: new Date(Date.now() + 600_000),
    });
    manager = startManager();
    await eventually(
      () => provider.inspect(stray),
      (state) => state === null,
    );
    await converged();
  });

  it('fails the provisioning a dead manager left behind and reaps its container', async () => {
    // This manager dies right after creating the container: its provisioning never
    // reports back, and its loop stops with it.
    await manager.stop();
    const dying: SandboxProvider = {
      provision: (spec) => {
        void provider.provision(spec).catch(() => {});
        return new Promise(() => {});
      },
      destroy: (id) => provider.destroy(id),
      inspect: (id) => provider.inspect(id),
      list: () => provider.list(),
    };
    manager = startManager(dying);
    const orphaned = await request();
    await eventually(
      () => provider.inspect(orphaned),
      (state) => state?.container === 'running',
    );
    await manager.stop();

    // A new process takes over with nothing in memory.
    manager = startManager();
    await eventually(
      () => store.get(orphaned),
      (r) => r?.status === 'FAILED',
      (PROVISION_TIMEOUT_S + 30) * 1000,
    );
    expect((await store.get(orphaned))?.failure).toBe('stuck');
    await converged();
  });

  it('reaps the container of a record deleted from the database', async () => {
    const id = await request();
    await ready(id);
    await db.pool.query('delete from sandboxes where id = $1', [id]);
    await eventually(
      () => provider.inspect(id),
      (state) => state === null,
    );
    await converged();
  });

  it('reaps expired sandboxes by label while the state database is down', async () => {
    // Deadline = admission + lifetime + provisioning timeout, as written on the label.
    const expiring = await request(1);
    const keeper = await request(600);
    await Promise.all([ready(expiring), ready(keeper)]);
    const deadline = (await store.get(expiring))!.expiresAt!.getTime();

    await pauseContainer(db.container.getId());
    try {
      await eventually(
        () => provider.inspect(expiring),
        (state) => state === null,
        deadline - Date.now() + 30_000,
      );
      expect(await provider.inspect(keeper)).toMatchObject({ container: 'running' });
    } finally {
      await unpauseContainer(db.container.getId());
    }
    // Back online, the records catch up with what the labels already did.
    await eventually(
      () => statusOf(expiring),
      (s) => s === 'DESTROYED' || s === 'FAILED',
    );
    expect(await statusOf(keeper)).toBe('READY');
    await converged();
  });

  it('converges after a random round of creates, kills, lost rows and restarts', async () => {
    const seed = Number(process.env.CHAOS_SEED ?? randomBytes(4).readUInt32LE());
    // Printed so a failing round can be replayed with CHAOS_SEED.
    console.info(`chaos seed: ${seed}`);
    const random = mulberry32(seed);
    const pick = <T>(items: readonly T[]): T | undefined =>
      items[Math.floor(random() * items.length)];

    for (let step = 0; step < 14; step++) {
      const roll = random();
      if (roll < 0.45) {
        await request();
      } else if (roll < 0.65) {
        const target = pick((await provider.list()).filter((s) => s.container === 'running'));
        if (target) await killContainer(resourceName(target.id)).catch(() => {});
      } else if (roll < 0.8) {
        const target = pick(await store.listLive());
        if (target) await db.pool.query('delete from sandboxes where id = $1', [target.id]);
      } else {
        await manager.stop();
        manager = startManager();
      }
      await sleep(random() * 2_000);
    }
    await converged(180_000);
  });
});

/** Small seeded PRNG: the same seed replays the same round. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
