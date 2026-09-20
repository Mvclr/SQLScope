import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { SessionEventBus } from '../events/session-event-bus.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PRISMA } from '../infrastructure/infrastructure.module.js';
import { SandboxProvisioner } from '../sandbox/provisioner.js';
import { SessionService } from './session.service.js';

const SWEEP_INTERVAL_MS = 30_000;
const WARN_BEFORE_MS = 2 * 60_000;
const STUCK_PROVISIONING_MS = 5 * 60_000;

/**
 * Keeps the sandbox cluster converged with the control database (ADR 0002): expires
 * sessions past their lifetime or quota, retries failed destroys, and drops any sandbox
 * database or role that no live session accounts for.
 */
@Injectable()
export class SessionReaper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SessionReaper.name);
  private timer: NodeJS.Timeout | undefined;
  private sweeping: Promise<void> | undefined;
  /** Sessions already warned, keyed to the activity time the warning was about. */
  private readonly warned = new Map<string, number>();
  private lastFailure: string | null = null;
  private repeatedFailures = 0;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: Config,
    private readonly sessions: SessionService,
    private readonly provisioner: SandboxProvisioner,
    private readonly bus: SessionEventBus,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    void this.sweep();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.sweeping;
  }

  /** One pass. Never overlaps itself; errors are logged, the next pass retries. */
  sweep(): Promise<void> {
    this.sweeping ??= this.pass()
      .catch((error: Error) => this.reportFailure(error))
      .finally(() => (this.sweeping = undefined));
    return this.sweeping;
  }

  /**
   * A sweep that fails usually keeps failing for the same reason — the control database
   * is down, say — every 30 seconds. Say it once, with one line, and then only every
   * tenth time, so the log stays readable while the cause is fixed.
   */
  private reportFailure(error: Error): void {
    // Prisma errors carry the whole query and a diagram; the first line is the reason.
    const reason = error.message.split('\n')[0]!.trim();
    this.repeatedFailures = reason === this.lastFailure ? this.repeatedFailures + 1 : 0;
    this.lastFailure = reason;
    if (this.repeatedFailures === 0) this.logger.error(`sweep failed: ${reason}`);
    else if (this.repeatedFailures % 10 === 0) {
      this.logger.error(`sweep still failing (${this.repeatedFailures + 1}×): ${reason}`);
    }
  }

  private async pass(): Promise<void> {
    await this.expireSessions();
    await this.retryDestroys();
    await this.dropOrphans();
  }

  private async expireSessions(): Promise<void> {
    const now = Date.now();
    const quotaBytes = this.config.SANDBOX_QUOTA_MB * 1024 * 1024;
    const active = await this.prisma.session.findMany({ where: { status: 'ACTIVE' } });

    for (const session of active) {
      const { idleExpiresAt, maxExpiresAt } = this.sessions.expiryOf(session);
      const expiresAt = Math.min(idleExpiresAt.getTime(), maxExpiresAt.getTime());

      if (now >= expiresAt) {
        await this.sessions.end(session, now >= maxExpiresAt.getTime() ? 'max-lifetime' : 'idle');
        this.warned.delete(session.id);
        continue;
      }
      const size = await this.provisioner.sizeInBytes(session.databaseName);
      if (size !== null && size > quotaBytes) {
        await this.sessions.end(session, 'quota');
        continue;
      }
      if (expiresAt - now <= WARN_BEFORE_MS && this.warned.get(session.id) !== expiresAt) {
        this.warned.set(session.id, expiresAt);
        this.bus.publish(session.id, {
          type: 'session-expiring',
          secondsLeft: Math.round((expiresAt - now) / 1000),
        });
      }
    }

    await this.prisma.session.updateMany({
      where: { status: 'PROVISIONING', createdAt: { lt: new Date(now - STUCK_PROVISIONING_MS) } },
      data: { status: 'FAILED', endedAt: new Date(), endReason: 'stuck provisioning' },
    });
  }

  private async retryDestroys(): Promise<void> {
    const pending = await this.prisma.session.findMany({
      where: { status: { in: ['EXPIRED', 'FAILED'] } },
    });
    for (const session of pending) {
      await this.provisioner.destroy(session.databaseName);
      await this.prisma.session.update({
        where: { id: session.id },
        data: { status: 'DESTROYED' },
      });
    }
  }

  /** Sandboxes on the cluster that no active or in-flight session owns. */
  private async dropOrphans(): Promise<void> {
    const onCluster = await this.provisioner.list();
    if (onCluster.length === 0) return;
    const owned = await this.prisma.session.findMany({
      where: { databaseName: { in: onCluster }, status: { in: ['ACTIVE', 'PROVISIONING'] } },
      select: { databaseName: true },
    });
    const keep = new Set(owned.map((s) => s.databaseName));
    for (const name of onCluster.filter((n) => !keep.has(n))) {
      this.logger.warn(`dropping orphaned sandbox ${name}`);
      await this.provisioner.destroy(name);
    }
  }
}
