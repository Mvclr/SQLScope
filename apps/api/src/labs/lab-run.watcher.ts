import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { LabRunService } from './lab-run.service.js';
import { SandboxManagerClient } from './sandbox-manager.client.js';

/** While a run is queued or provisioning, poll fast; once it is settled, poll slowly. */
const FAST_INTERVAL_MS = 2_000;
const SLOW_INTERVAL_MS = 10_000;

/**
 * The manager has no way to push, so the API pulls: every tick it reconciles the live lab
 * runs against the manager and lets the service publish what changed — a queue position, a
 * ready sandbox, an ended run (ADR 0010). Because it reads the live runs from the control
 * database each tick, a fresh process resumes tracking whatever was in flight.
 */
@Injectable()
export class LabRunWatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LabRunWatcher.name);
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  private stopped = false;
  private lastFailure: string | null = null;
  private repeatedFailures = 0;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly runs: LabRunService,
    private readonly manager: SandboxManagerClient,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.schedule(FAST_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.ticking;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.ticking = this.tick()
        .then((busy) => this.schedule(busy ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS))
        .catch((error: Error) => {
          this.reportFailure(error);
          this.schedule(SLOW_INTERVAL_MS);
        });
    }, delayMs);
  }

  /** One reconciliation pass. Returns whether any run is still queued or provisioning. */
  async tick(): Promise<boolean> {
    const runs = await this.runs.liveRuns();
    let busy = false;
    for (const run of runs) {
      // The owning session ended (the user closed it, or the reaper expired it): the lab
      // goes with it, and its sandbox is released. This is what keeps the two lifecycles
      // tied without the session code having to know about labs.
      if (run.session.status !== 'ACTIVE') {
        await this.runs.endRun(run, 'session ended').catch((error: Error) => {
          this.logger.warn(`ending run ${run.id} failed: ${error.message}`);
        });
        continue;
      }
      if (!run.sandboxId) continue; // Only sandbox-bound runs are polled (see liveRuns).
      const sandbox = await this.manager.get(run.sandboxId);
      if (!sandbox) {
        // The manager forgot it: treat as ended so the binding is cleaned up.
        await this.runs.sync(run, endedSandbox(run.sandboxId)).catch((error: Error) => {
          this.logger.warn(`cleaning up run ${run.id} failed: ${error.message}`);
        });
        continue;
      }
      await this.runs.sync(run, sandbox).catch((error: Error) => {
        this.logger.warn(`syncing run ${run.id} failed: ${error.message}`);
      });
      if (sandbox.status === 'PENDING' || sandbox.status === 'PROVISIONING') busy = true;
    }
    this.lastFailure = null;
    return busy;
  }

  /**
   * A tick that fails usually keeps failing for the same reason — the manager is down —
   * every few seconds. Say it once, then only every tenth time, like the session reaper.
   */
  private reportFailure(error: Error): void {
    const reason = error.message.split('\n')[0]!.trim();
    this.repeatedFailures = reason === this.lastFailure ? this.repeatedFailures + 1 : 0;
    this.lastFailure = reason;
    if (this.repeatedFailures === 0) this.logger.error(`lab watcher failed: ${reason}`);
    else if (this.repeatedFailures % 10 === 0) {
      this.logger.error(`lab watcher still failing (${this.repeatedFailures + 1}×): ${reason}`);
    }
  }
}

/** A synthetic ended view, for a sandbox the manager no longer knows. */
function endedSandbox(id: string) {
  return {
    id,
    status: 'DESTROYED' as const,
    queuePosition: null,
    expiresAt: null,
    idleExpiresAt: null,
    endReason: 'destroyed',
    failure: null,
    connection: null,
  };
}
