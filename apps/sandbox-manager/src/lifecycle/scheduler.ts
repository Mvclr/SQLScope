import { randomBytes } from 'node:crypto';
import { describe } from '../http/health.js';
import { newSandboxId, type SandboxId, type SandboxRecord } from '../domain/sandbox.js';
import type { Clock, Log } from '../log.js';
import type { SandboxProvider } from '../provider/provider.js';
import type { PgStore } from '../store/pg-store.js';
import { provisionSandbox, type ProvisionOutcome } from './provisioning.js';

export class QueueFullError extends Error {
  constructor() {
    super('the sandbox queue is full');
    this.name = 'QueueFullError';
  }
}

export interface SchedulerOptions {
  readonly maxActive: number;
  readonly maxQueue: number;
  readonly provisionTimeoutSeconds: number;
}

export interface SandboxRequest {
  readonly requestId: string;
  readonly seed: string;
  readonly ttlSeconds: number;
  readonly idleSeconds: number;
}

export type HeartbeatResult =
  | { readonly outcome: 'ok'; readonly record: SandboxRecord }
  | { readonly outcome: 'not-found' }
  | { readonly outcome: 'conflict'; readonly record: SandboxRecord };

/** A compare-and-set that loses to a concurrent writer is retried this many times. */
const CAS_RETRIES = 3;

/**
 * Admission, the queue and the transitions requested over HTTP (ADR 0002). Above
 * MAX_ACTIVE_SANDBOXES a request waits in the queue — the PENDING rows — and is admitted
 * as slots free up; above MAX_QUEUE it is refused.
 */
export class Scheduler {
  private readonly inFlight = new Map<SandboxId, Promise<ProvisionOutcome>>();
  /** Called once per finished provisioning; the metrics hook in here. */
  onProvisioned: (outcome: ProvisionOutcome) => void = () => {};

  constructor(
    private readonly store: PgStore,
    private readonly provider: SandboxProvider,
    private readonly options: SchedulerOptions,
    private readonly clock: Clock,
    private readonly log: Log,
  ) {}

  /** Sandboxes this process is provisioning right now. The reconciler leaves them alone. */
  get provisioning(): ReadonlySet<SandboxId> {
    return new Set(this.inFlight.keys());
  }

  /**
   * Creates a PENDING sandbox — or returns the one this `requestId` already created — and
   * admits what fits. The queue check is not atomic with the insert: under a burst the
   * queue may overshoot MAX_QUEUE by the number of concurrent requests, which bounds it
   * just as well.
   */
  async request(input: SandboxRequest): Promise<{ record: SandboxRecord; created: boolean }> {
    const existing = await this.store.getByRequestId(input.requestId);
    if (existing) return { record: existing, created: false };
    if ((await this.store.queueLength()) >= this.options.maxQueue) throw new QueueFullError();

    const { record, created } = await this.store.create({
      id: newSandboxId(),
      requestId: input.requestId,
      seed: input.seed,
      labPassword: randomBytes(24).toString('hex'),
      ttlSeconds: input.ttlSeconds,
      idleSeconds: input.idleSeconds,
      now: this.clock(),
    });
    if (created) await this.admit();
    return { record: (await this.store.get(record.id)) ?? record, created };
  }

  /** Promotes queued sandboxes into free slots and starts provisioning them. */
  async admit(): Promise<void> {
    const admitted = await this.store.admit(
      this.options.maxActive,
      this.clock(),
      this.options.provisionTimeoutSeconds,
    );
    for (const record of admitted) this.startProvisioning(record);
  }

  /**
   * Ends a sandbox on the caller's request. Queued, it is simply dropped; otherwise it
   * goes to EXPIRING with the reason `released` and the loop tears it down, the same way
   * an expired one is. Idempotent: a sandbox already on its way out is returned as is.
   */
  async release(id: SandboxId): Promise<SandboxRecord | null> {
    for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
      const record = await this.store.get(id);
      if (record === null) return null;
      const at = this.clock();
      let moved: SandboxRecord | null;
      switch (record.status) {
        case 'PENDING':
          moved = await this.store.transition(id, 'PENDING', 'DESTROYED', {
            at,
            reason: 'released',
          });
          break;
        case 'PROVISIONING':
        case 'READY':
        case 'ACTIVE':
          moved = await this.store.transition(id, record.status, 'EXPIRING', {
            at,
            reason: 'released',
          });
          break;
        default:
          return record;
      }
      if (moved) return moved;
    }
    return this.store.get(id);
  }

  /**
   * The client is using the sandbox: the first heartbeat claims a READY one (→ ACTIVE),
   * the next ones push the idle deadline back.
   */
  async heartbeat(id: SandboxId): Promise<HeartbeatResult> {
    for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
      const record = await this.store.get(id);
      if (record === null) return { outcome: 'not-found' };
      const now = this.clock();
      let updated: SandboxRecord | null;
      if (record.status === 'READY') {
        updated = await this.store.transition(id, 'READY', 'ACTIVE', {
          at: now,
          patch: { lastHeartbeatAt: now },
        });
      } else if (record.status === 'ACTIVE') {
        updated = await this.store.touch(id, now);
      } else {
        return { outcome: 'conflict', record };
      }
      if (updated) return { outcome: 'ok', record: updated };
    }
    const record = await this.store.get(id);
    return record ? { outcome: 'conflict', record } : { outcome: 'not-found' };
  }

  /** Waits for the provisionings in flight, so a shutdown does not strand them midway. */
  async drain(): Promise<void> {
    await Promise.allSettled(this.inFlight.values());
  }

  private startProvisioning(record: SandboxRecord): void {
    const run = provisionSandbox(record, {
      store: this.store,
      provider: this.provider,
      clock: this.clock,
      log: this.log,
    })
      .then((outcome) => {
        this.onProvisioned(outcome);
        return outcome;
      })
      .catch((error: unknown) => {
        // provisionSandbox handles provider errors; this is the state database failing
        // while recording the outcome. The record stays PROVISIONING and the loop fails it
        // as stuck once it is past the timeout.
        this.log.error(`provisioning ${record.id} could not be recorded: ${describe(error)}`);
        return { result: 'failed', seconds: 0 } satisfies ProvisionOutcome;
      })
      .finally(() => this.inFlight.delete(record.id));
    this.inFlight.set(record.id, run);
  }
}
