import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { newSandboxId } from '../src/domain/sandbox.js';
import { createMetrics } from '../src/metrics.js';
import { PgStore } from '../src/store/pg-store.js';
import { startStateDatabase, type StateDatabase } from './support/state-database.js';

let db: StateDatabase;
let store: PgStore;

beforeAll(async () => {
  db = await startStateDatabase();
  store = new PgStore(db.pool);
});
afterAll(() => db?.stop());

const config = loadConfig({
  NODE_ENV: 'test',
  SANDBOX_MANAGER_TOKEN: 'x'.repeat(32),
  STATE_DATABASE_URL: 'postgres://unused@localhost/unused',
});

function sample(text: string, series: string): number | undefined {
  const line = text.split('\n').find((l) => l.startsWith(`${series} `));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
}

describe('/metrics', () => {
  it('reads the counts from the state database and exposes the counters', async () => {
    for (const requestId of ['a', 'b', 'c']) {
      await store.create({
        id: newSandboxId(),
        requestId,
        seed: '',
        labPassword: 'ab',
        ttlSeconds: 60,
        idleSeconds: 60,
        now: new Date(),
      });
    }
    await store.admit(1, new Date(), 60);

    const metrics = createMetrics(store);
    metrics.provisioned({ result: 'ready', seconds: 2.5 });
    metrics.provisioned({ result: 'failed', seconds: 1 });
    metrics.reconciler.orphan('container');
    metrics.reconciler.failed('container-lost');
    metrics.reconciler.pass(0.02);
    metrics.reconciler.degraded();

    const app = buildApp({
      config,
      checks: [],
      store,
      scheduler: {} as never,
      metrics: metrics.registry,
    });
    // No token: Prometheus scrapes it on the internal network.
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/plain/);
    const text = response.body;

    expect(sample(text, 'sqlscope_sandboxes{status="PENDING"}')).toBe(2);
    expect(sample(text, 'sqlscope_sandboxes{status="PROVISIONING"}')).toBe(1);
    expect(sample(text, 'sqlscope_sandboxes{status="READY"}')).toBe(0);
    expect(text).not.toContain('status="DESTROYED"');
    expect(sample(text, 'sqlscope_sandbox_queue_length')).toBe(2);
    expect(sample(text, 'sqlscope_sandbox_provision_duration_seconds_count')).toBe(1);
    expect(sample(text, 'sqlscope_sandbox_failures_total{reason="provision-failed"}')).toBe(1);
    expect(sample(text, 'sqlscope_sandbox_failures_total{reason="container-lost"}')).toBe(1);
    expect(sample(text, 'sqlscope_sandbox_orphans_collected_total{kind="container"}')).toBe(1);
    expect(sample(text, 'sqlscope_reconcile_duration_seconds_count')).toBe(1);
    expect(sample(text, 'sqlscope_reconcile_degraded_total')).toBe(1);
    expect(sample(text, 'sqlscope_reconcile_errors_total')).toBe(0);
    expect(text).toContain('process_cpu_seconds_total');
  });
});
