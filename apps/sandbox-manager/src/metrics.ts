import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { SANDBOX_STATUSES, TERMINAL_STATUSES, type SandboxStatus } from './domain/sandbox.js';
import type { ProvisionOutcome } from './lifecycle/provisioning.js';
import type { ReconcilerEvents } from './reconcile/reconciler.js';
import type { PgStore } from './store/pg-store.js';

const LIVE_STATUSES = SANDBOX_STATUSES.filter((status) => !TERMINAL_STATUSES.includes(status));

export interface Metrics {
  readonly registry: Registry;
  /** Hook for Scheduler.onProvisioned. */
  provisioned(outcome: ProvisionOutcome): void;
  /** Hooks for Reconciler.events. */
  readonly reconciler: ReconcilerEvents;
}

/**
 * Prometheus metrics on a registry of the manager's own. The counts by status are read
 * from the state database on every scrape rather than kept in memory, so they are right
 * from the first scrape after a restart; the counters are per process, as usual.
 */
export function createMetrics(store: PgStore): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const registers = [registry];

  // A scrape collects every metric concurrently; both gauges share one query per scrape.
  // With the state database down they keep their last values, and the degraded counter
  // says why.
  let counting: Promise<Record<SandboxStatus, number> | null> | null = null;
  const counts = () =>
    (counting ??= store
      .countByStatus()
      .catch(() => null)
      .finally(() => (counting = null)));

  new Gauge({
    name: 'sqlscope_sandboxes',
    help: 'Live T2 sandboxes by status. Ended ones are counted by the failure counter.',
    labelNames: ['status'],
    registers,
    async collect() {
      const current = await counts();
      if (current) for (const status of LIVE_STATUSES) this.set({ status }, current[status]);
    },
  });
  new Gauge({
    name: 'sqlscope_sandbox_queue_length',
    help: 'T2 sandbox requests waiting for a slot.',
    registers,
    async collect() {
      const current = await counts();
      if (current) this.set(current.PENDING);
    },
  });

  const provisionDuration = new Histogram({
    name: 'sqlscope_sandbox_provision_duration_seconds',
    help: 'Time from admission to a ready T2 sandbox.',
    buckets: [0.5, 1, 2, 3, 5, 8, 13, 21, 34, 60],
    registers,
  });
  const failures = new Counter({
    name: 'sqlscope_sandbox_failures_total',
    help: 'T2 sandboxes that ended in FAILED, by reason.',
    labelNames: ['reason'],
    registers,
  });
  const orphans = new Counter({
    name: 'sqlscope_sandbox_orphans_collected_total',
    help: 'Resources reconciliation removed: containers and networks no record owned, and records whose container was gone.',
    labelNames: ['kind'],
    registers,
  });
  const reconcileDuration = new Histogram({
    name: 'sqlscope_reconcile_duration_seconds',
    help: 'Duration of a complete reconciliation pass.',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers,
  });
  const reconcileErrors = new Counter({
    name: 'sqlscope_reconcile_errors_total',
    help: 'Reconciliation passes that failed outright.',
    registers,
  });
  const reconcileDegraded = new Counter({
    name: 'sqlscope_reconcile_degraded_total',
    help: 'Reconciliation passes run on container labels alone, with the state database down.',
    registers,
  });

  return {
    registry,
    provisioned(outcome) {
      if (outcome.result === 'ready') provisionDuration.observe(outcome.seconds);
      if (outcome.result === 'failed') failures.inc({ reason: 'provision-failed' });
    },
    reconciler: {
      pass: (seconds) => reconcileDuration.observe(seconds),
      error: () => reconcileErrors.inc(),
      degraded: () => reconcileDegraded.inc(),
      orphan: (kind) => orphans.inc({ kind }),
      failed: (reason) => failures.inc({ reason }),
    },
  };
}
