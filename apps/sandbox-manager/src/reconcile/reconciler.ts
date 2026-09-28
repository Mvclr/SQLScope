import type { SandboxId } from '../domain/sandbox.js';
import { describe } from '../http/health.js';
import type { Scheduler } from '../lifecycle/scheduler.js';
import type { Clock, Log } from '../log.js';
import type { SandboxProvider } from '../provider/provider.js';
import type { PgStore } from '../store/pg-store.js';
import {
  planDegraded,
  planReconcile,
  type ReconcileAction,
  type ReconcileSettings,
} from './plan.js';

/** A teardown that fails this many times gives up: FAILED, and the container is an orphan. */
export const DESTROY_MAX_ATTEMPTS = 5;

/** What the loop reports; the metrics hook in here. */
export interface ReconcilerEvents {
  pass(seconds: number): void;
  error(): void;
  degraded(): void;
  orphan(resource: 'container' | 'network' | 'record'): void;
  failed(reason: string): void;
}

const noEvents: ReconcilerEvents = {
  pass() {},
  error() {},
  degraded() {},
  orphan() {},
  failed() {},
};

/**
 * The reconciliation loop of ADR 0002, in the style of a Kubernetes controller: every
 * interval it compares the records with the runtime and acts on the difference. Every
 * action is idempotent — a status change is a compare-and-set, a destroy of what is gone
 * succeeds — so a pass interrupted halfway is simply finished by the next one.
 */
export class Reconciler {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private lastFailure: string | null = null;
  private repeatedFailures = 0;
  events: ReconcilerEvents = noEvents;

  constructor(
    private readonly store: PgStore,
    private readonly provider: SandboxProvider,
    private readonly scheduler: Scheduler,
    private readonly settings: ReconcileSettings,
    private readonly clock: Clock,
    private readonly log: Log,
  ) {}

  start(intervalMs: number): void {
    this.timer = setInterval(() => void this.trigger(), intervalMs);
    void this.trigger();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** Runs one pass now, or joins the one already running; passes never overlap. */
  trigger(): Promise<void> {
    this.running ??= this.pass()
      .catch((error: unknown) => {
        this.events.error();
        this.reportFailure(error);
      })
      .finally(() => (this.running = undefined));
    return this.running;
  }

  private async pass(): Promise<void> {
    const startedAt = performance.now();
    const observedAt = this.clock();
    const observed = await this.provider.list();

    let records;
    try {
      records = await this.store.listLive();
    } catch (error) {
      await this.degradedPass(observed, error);
      return;
    }

    const actions = planReconcile({
      now: this.clock(),
      observed,
      observedAt,
      records,
      provisioning: this.scheduler.provisioning,
      settings: this.settings,
    });
    for (const action of actions) {
      try {
        await this.execute(action);
      } catch (error) {
        // One sandbox failing must not hold back the others; the next pass retries it.
        this.log.warn(`reconcile ${action.kind} ${action.id} failed: ${describe(error)}`);
      }
    }
    // A deploy that recreated an attached client (the API) took it off every sandbox
    // network; the live ones get it back, or their labs lose the database midway.
    const reattach = this.provider.reattach?.bind(this.provider);
    if (reattach) {
      for (const record of records.filter((r) => r.status === 'READY' || r.status === 'ACTIVE')) {
        await reattach(record.id).catch((error: unknown) => {
          this.log.warn(`reattaching ${record.id} failed: ${describe(error)}`);
        });
      }
    }
    // Teardowns may have freed slots for the queue.
    await this.scheduler.admit();
    this.events.pass((performance.now() - startedAt) / 1000);
    this.lastFailure = null;
  }

  private async degradedPass(
    observed: Awaited<ReturnType<SandboxProvider['list']>>,
    cause: unknown,
  ): Promise<void> {
    this.events.degraded();
    this.reportFailure(cause, 'state database unavailable, reaping by label only');
    for (const action of planDegraded(observed, this.clock())) {
      await this.reap(action.id, action.resource).catch((error: unknown) => {
        this.log.warn(`reaping ${action.id} failed: ${describe(error)}`);
      });
    }
  }

  private async execute(action: ReconcileAction): Promise<void> {
    switch (action.kind) {
      case 'reap-orphan':
        return this.reap(action.id, action.resource);
      case 'fail': {
        const failed = await this.store.transition(action.id, action.from, 'FAILED', {
          at: this.clock(),
          reason: action.reason,
        });
        if (!failed) return;
        this.log.warn(`sandbox ${action.id} failed: ${action.reason}`);
        this.events.failed(action.reason);
        this.events.orphan('record');
        // Whatever is left of it goes now rather than as an orphan on the next pass.
        await this.provider.destroy(action.id);
        return;
      }
      case 'expire': {
        const expiring = await this.store.transition(action.id, action.from, 'EXPIRING', {
          at: this.clock(),
          reason: action.reason,
        });
        if (expiring) await this.teardown(action.id, 'EXPIRING');
        return;
      }
      case 'teardown':
        return this.teardown(action.id, action.from);
    }
  }

  /** EXPIRING → DESTROYING → destroy → DESTROYED; a DESTROYING left by a crash resumes. */
  private async teardown(id: SandboxId, from: 'EXPIRING' | 'DESTROYING'): Promise<void> {
    if (from === 'EXPIRING') {
      const moved = await this.store.transition(id, 'EXPIRING', 'DESTROYING', { at: this.clock() });
      if (!moved) return;
    }
    try {
      await this.provider.destroy(id);
    } catch (error) {
      const attempts = await this.store.recordDestroyFailure(id);
      if (attempts < DESTROY_MAX_ATTEMPTS) throw error;
      // Give up on the record; the container, now owned by no live record, is retried as
      // an orphan on every pass.
      const failed = await this.store.transition(id, 'DESTROYING', 'FAILED', {
        at: this.clock(),
        reason: 'destroy-failed',
      });
      if (failed) this.events.failed('destroy-failed');
      throw error;
    }
    await this.store.transition(id, 'DESTROYING', 'DESTROYED', { at: this.clock() });
  }

  private async reap(id: SandboxId, resource: 'container' | 'network'): Promise<void> {
    this.log.warn(`reaping orphaned ${resource} of sandbox ${id}`);
    await this.provider.destroy(id);
    this.events.orphan(resource);
  }

  /**
   * A pass that fails usually keeps failing for the same reason — the Docker proxy is
   * down, say — every few seconds. Say it once, and then only every tenth time, so the
   * log stays readable while the cause is fixed.
   */
  private reportFailure(error: unknown, context = 'reconcile pass failed'): void {
    const reason = `${context}: ${describe(error).split('\n')[0]!.trim()}`;
    this.repeatedFailures = reason === this.lastFailure ? this.repeatedFailures + 1 : 0;
    this.lastFailure = reason;
    if (this.repeatedFailures === 0) this.log.error(reason);
    else if (this.repeatedFailures % 10 === 0) {
      this.log.error(`${reason} (${this.repeatedFailures + 1}× in a row)`);
    }
  }
}
