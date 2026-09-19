import { Inject, Injectable, Logger } from '@nestjs/common';
import { err, ok, type Result } from '@sqlscope/core';
import { CONFIG, type Config } from '../config.js';
import { SessionEventBus } from '../events/session-event-bus.js';
import { SessionLog } from '../events/session-log.js';
import type { PrismaClient, Session } from '../generated/prisma/client.js';
import { PRISMA } from '../infrastructure/infrastructure.module.js';
import { newSandboxCredentials, SandboxProvisioner } from '../sandbox/provisioner.js';
import { SessionConnections } from '../sandbox/session-connections.js';

export type SessionRefusal = 'client-limit' | 'capacity';

export interface SessionTimes {
  readonly idleExpiresAt: Date;
  readonly maxExpiresAt: Date;
}

/** `lastActiveAt` is only rewritten when older than this, to spare the control database. */
const TOUCH_INTERVAL_MS = 15_000;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: Config,
    private readonly provisioner: SandboxProvisioner,
    private readonly connections: SessionConnections,
    private readonly log: SessionLog,
    private readonly bus: SessionEventBus,
  ) {}

  /**
   * Provisions a new T1 sandbox. Quotas are checked first; they are best-effort under
   * concurrent requests, which the rate limit on this endpoint keeps rare.
   */
  async create(clientHash: string): Promise<Result<Session, SessionRefusal>> {
    const [ofClient, total] = await Promise.all([
      this.prisma.session.count({ where: { clientHash, status: 'ACTIVE' } }),
      this.prisma.session.count({ where: { status: { in: ['ACTIVE', 'PROVISIONING'] } } }),
    ]);
    if (ofClient >= this.config.MAX_SESSIONS_PER_CLIENT) return err('client-limit');
    if (total >= this.config.MAX_ACTIVE_SESSIONS) return err('capacity');

    const credentials = newSandboxCredentials();
    const session = await this.prisma.session.create({
      data: {
        databaseName: credentials.databaseName,
        rolePassword: credentials.password,
        clientHash,
      },
    });

    try {
      await this.provisioner.create(credentials, {
        statementTimeoutMs: this.config.STATEMENT_TIMEOUT_MS,
      });
    } catch (error) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { status: 'FAILED', endedAt: new Date(), endReason: 'provisioning failed' },
      });
      throw error;
    }

    await this.log.recordSnapshot(session.id, { tables: [] });
    return ok(
      await this.prisma.session.update({ where: { id: session.id }, data: { status: 'ACTIVE' } }),
    );
  }

  /** The session, if it is active and within its lifetime. */
  async findActive(id: string): Promise<Session | null> {
    const session = await this.prisma.session.findFirst({ where: { id, status: 'ACTIVE' } });
    if (!session) return null;
    const expiry = this.expiryOf(session);
    const now = Date.now();
    if (now >= expiry.idleExpiresAt.getTime() || now >= expiry.maxExpiresAt.getTime()) {
      // The reaper will get to it; do not hand out a session about to be dropped.
      return null;
    }
    return session;
  }

  async touch(session: Session): Promise<void> {
    if (Date.now() - session.lastActiveAt.getTime() < TOUCH_INTERVAL_MS) return;
    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date() },
    });
  }

  expiryOf(session: Pick<Session, 'createdAt' | 'lastActiveAt'>): SessionTimes {
    return {
      idleExpiresAt: new Date(
        session.lastActiveAt.getTime() + this.config.SESSION_IDLE_MINUTES * 60_000,
      ),
      maxExpiresAt: new Date(
        session.createdAt.getTime() + this.config.SESSION_MAX_MINUTES * 60_000,
      ),
    };
  }

  /**
   * Ends a session and destroys its sandbox. Safe to call more than once: a failed destroy
   * leaves the session EXPIRED, and the reaper retries it.
   */
  async end(session: Pick<Session, 'id' | 'databaseName'>, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: session.id, status: { in: ['ACTIVE', 'PROVISIONING'] } },
      data: { status: 'EXPIRED', endedAt: new Date(), endReason: reason },
    });
    this.bus.publish(session.id, { type: 'session-ended', reason });
    await this.connections.release(session.id);
    try {
      await this.provisioner.destroy(session.databaseName);
      await this.prisma.session.update({
        where: { id: session.id },
        data: { status: 'DESTROYED' },
      });
    } catch (error) {
      this.logger.warn(`could not destroy ${session.databaseName}: ${(error as Error).message}`);
    }
  }
}
