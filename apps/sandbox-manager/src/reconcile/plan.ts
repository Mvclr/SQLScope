import type { EndReason, SandboxId, SandboxRecord } from '../domain/sandbox.js';
import type { SandboxObservedState } from '../provider/provider.js';

export interface ReconcileSettings {
  readonly provisionTimeoutMs: number;
  /** How long a READY sandbox waits for the heartbeat that claims it. */
  readonly readyClaimMs: number;
}

export type ReconcileAction =
  /** On the runtime, labelled as ours, and no live record owns it. */
  | {
      readonly kind: 'reap-orphan';
      readonly id: SandboxId;
      readonly resource: 'container' | 'network';
    }
  | {
      readonly kind: 'fail';
      readonly id: SandboxId;
      readonly from: SandboxRecord['status'];
      readonly reason: 'container-lost' | 'stuck';
    }
  | {
      readonly kind: 'expire';
      readonly id: SandboxId;
      readonly from: 'READY' | 'ACTIVE';
      readonly reason: Exclude<EndReason, 'released'>;
    }
  | { readonly kind: 'teardown'; readonly id: SandboxId; readonly from: 'EXPIRING' | 'DESTROYING' };

export type ReapOrphan = Extract<ReconcileAction, { kind: 'reap-orphan' }>;

export interface ReconcileInput {
  readonly now: Date;
  /** What the runtime showed, and when the listing started. */
  readonly observed: readonly SandboxObservedState[];
  readonly observedAt: Date;
  /** Every live record, read after the listing. */
  readonly records: readonly SandboxRecord[];
  /** Sandboxes this process is provisioning right now. */
  readonly provisioning: ReadonlySet<SandboxId>;
  readonly settings: ReconcileSettings;
}

const GONE = new Set<SandboxObservedState['container']>([null, 'exited', 'dead']);

/**
 * One pass of the loop of ADR 0002, as data: desired state (the records) against observed
 * state (the runtime) at `now`. Pure, so every rule is a row in a table test.
 *
 * The runtime is listed *before* the records are read. The record of a container always
 * moves to PROVISIONING before the container is created, so anything the listing shows
 * already has a live record by the time the records are read — unless that record ended,
 * which is exactly an orphan. Read the other way round, a container created between the
 * two reads would look like one nobody owns.
 */
export function planReconcile(input: ReconcileInput): ReconcileAction[] {
  const { now, observedAt, settings } = input;
  const actions: ReconcileAction[] = [];
  const live = new Map(input.records.map((record) => [record.id, record]));
  const observed = new Map(input.observed.map((state) => [state.id, state]));

  for (const state of input.observed) {
    if (!live.has(state.id)) {
      actions.push({
        kind: 'reap-orphan',
        id: state.id,
        resource: state.container === null ? 'network' : 'container',
      });
    }
  }

  for (const record of input.records) {
    switch (record.status) {
      case 'PROVISIONING': {
        const startedAt = record.provisioningAt?.getTime() ?? record.requestedAt.getTime();
        // A provisioning this process runs ends on its own, success or timeout. One past
        // the timeout that nobody runs is the trace of a crash midway.
        if (
          !input.provisioning.has(record.id) &&
          now.getTime() - startedAt > settings.provisionTimeoutMs
        ) {
          actions.push({ kind: 'fail', id: record.id, from: record.status, reason: 'stuck' });
        }
        break;
      }
      case 'READY':
      case 'ACTIVE': {
        // Became ready after the listing started: the listing cannot speak for it yet.
        const judgeable = record.readyAt !== null && record.readyAt < observedAt;
        if (judgeable && GONE.has(observed.get(record.id)?.container ?? null)) {
          actions.push({
            kind: 'fail',
            id: record.id,
            from: record.status,
            reason: 'container-lost',
          });
          break;
        }
        const reason = expiry(record, now, settings);
        if (reason) actions.push({ kind: 'expire', id: record.id, from: record.status, reason });
        break;
      }
      case 'EXPIRING':
      case 'DESTROYING':
        actions.push({ kind: 'teardown', id: record.id, from: record.status });
        break;
      case 'PENDING':
      case 'DESTROYED':
      case 'FAILED':
        break;
    }
  }
  return actions;
}

function expiry(
  record: SandboxRecord,
  now: Date,
  settings: ReconcileSettings,
): Exclude<EndReason, 'released'> | null {
  const t = now.getTime();
  if (record.expiresAt !== null && t >= record.expiresAt.getTime()) return 'max-lifetime';
  if (record.status === 'READY' && record.readyAt !== null) {
    if (t >= record.readyAt.getTime() + settings.readyClaimMs) return 'unclaimed';
  }
  if (record.status === 'ACTIVE' && record.lastHeartbeatAt !== null) {
    if (t >= record.lastHeartbeatAt.getTime() + record.idleSeconds * 1000) return 'idle';
  }
  return null;
}

/**
 * The loop with the state database down (ADR 0002): no record to compare against, so the
 * labels decide alone. Whatever is past its `sqlscope.expires-at` goes; nothing else is
 * touched, since a sandbox still in its lifetime may well be in use.
 */
export function planDegraded(observed: readonly SandboxObservedState[], now: Date): ReapOrphan[] {
  return observed
    .filter((state) => state.expiresAt !== null && now >= state.expiresAt)
    .map((state): ReapOrphan => ({
      kind: 'reap-orphan',
      id: state.id,
      resource: state.container === null ? 'network' : 'container',
    }));
}
