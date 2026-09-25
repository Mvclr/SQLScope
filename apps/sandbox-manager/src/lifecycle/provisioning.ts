import { describe } from '../http/health.js';
import type { SandboxRecord } from '../domain/sandbox.js';
import type { Clock, Log } from '../log.js';
import type { SandboxProvider } from '../provider/provider.js';
import type { PgStore } from '../store/pg-store.js';

export interface ProvisionOutcome {
  readonly result: 'ready' | 'released' | 'failed';
  readonly seconds: number;
}

/**
 * Builds the container of one sandbox already in PROVISIONING. Runs outside any
 * transaction: the record moved first, so reconciliation sees the container as owned
 * from the moment it exists.
 */
export async function provisionSandbox(
  record: SandboxRecord,
  deps: { store: PgStore; provider: SandboxProvider; clock: Clock; log: Log },
): Promise<ProvisionOutcome> {
  const { store, provider, clock, log } = deps;
  const startedAt = performance.now();
  const seconds = () => (performance.now() - startedAt) / 1000;

  try {
    const handle = await provider.provision({
      id: record.id,
      seed: record.seed ?? '',
      labPassword: record.labPassword ?? '',
      expiresAt: record.expiresAt ?? new Date(clock().getTime() + record.ttlSeconds * 1000),
    });
    const now = clock();
    const ready = await store.transition(record.id, 'PROVISIONING', 'READY', {
      at: now,
      patch: { readyAt: now, host: handle.connection.host, port: handle.connection.port },
    });
    if (ready) return { result: 'ready', seconds: seconds() };
    // Released, or failed by a reconciler, while the container was being built. The loop
    // tears the container down either way: an EXPIRING record like any expired one, and a
    // FAILED one's container as an orphan.
    log.info(`sandbox ${record.id} left PROVISIONING before it was ready`);
    return { result: 'released', seconds: seconds() };
  } catch (error) {
    log.warn(`provisioning ${record.id} failed: ${describe(error)}`);
    await store.transition(record.id, 'PROVISIONING', 'FAILED', {
      at: clock(),
      reason: 'provision-failed',
    });
    // Best effort; whatever survives is an orphan the loop collects.
    await provider.destroy(record.id).catch(() => {});
    return { result: 'failed', seconds: seconds() };
  }
}
