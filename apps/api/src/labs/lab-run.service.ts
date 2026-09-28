import { Inject, Injectable, Logger } from '@nestjs/common';
import { err, ok, type Result } from '@sqlscope/core';
import { runScript, type ScriptResult } from '@sqlscope/engine';
import { buildSearch, findLab, type SearchMode } from '@sqlscope/labs';
import { CONFIG, type Config } from '../config.js';
import { SessionEventBus } from '../events/session-event-bus.js';
import type { LabRun, PrismaClient, Session } from '../generated/prisma/client.js';
import { PRISMA } from '../infrastructure/infrastructure.module.js';
import { SessionService } from '../sessions/session.service.js';
import { type AppResult, LabConnections, type SandboxConnection } from './lab-connections.js';
import {
  ManagerAtCapacityError,
  SandboxManagerClient,
  type ManagerSandbox,
  type ManagerStatus,
} from './sandbox-manager.client.js';

/** The statuses the API tracks; the rest of the manager's statuses all mean "ended". */
export type LiveStatus = 'PENDING' | 'PROVISIONING' | 'READY' | 'ACTIVE';

export function liveStatusOf(status: ManagerStatus): LiveStatus | 'ended' {
  switch (status) {
    case 'PENDING':
    case 'PROVISIONING':
    case 'READY':
    case 'ACTIVE':
      return status;
    default:
      return 'ended';
  }
}

/** What the browser is told about its run. The sandbox's credentials never appear here. */
export interface LabRunView {
  readonly labId: string;
  readonly status: LiveStatus;
  readonly queuePosition: number | null;
  readonly expiresAt: string | null;
  readonly idleExpiresAt: string | null;
}

export type StartRefusal = 'unknown-lab' | 'client-limit' | 'capacity';
export type RunRefusal = 'no-run' | 'not-ready';

/** Idle heartbeats are coalesced: one call to the manager every this often, at most. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Owns the API's side of a T2 lab run (ADR 0010): asks the manager for a sandbox, mirrors
 * its status, drives the mini-app and the console against it, and tears the binding down
 * when it ends. The manager is the source of truth for the sandbox; this holds only the
 * live binding and the open connections.
 */
@Injectable()
export class LabRunService {
  private readonly logger = new Logger(LabRunService.name);
  /** Where each run's sandbox is reached, learned when it turns READY. */
  private readonly connectionOf = new Map<string, SandboxConnection>();
  /** Last heartbeat sent per run, to coalesce them. */
  private readonly lastHeartbeat = new Map<string, number>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: Config,
    private readonly manager: SandboxManagerClient,
    private readonly connections: LabConnections,
    private readonly sessions: SessionService,
    private readonly bus: SessionEventBus,
  ) {}

  /** Starts a lab for the session, or returns the one it is already running. */
  async start(session: Session, labId: string): Promise<Result<LabRunView, StartRefusal>> {
    const lab = findLab(labId);
    if (!lab || (lab.runtime ?? 'browser') !== 'sandbox') return err('unknown-lab');

    const existing = await this.prisma.labRun.findUnique({ where: { sessionId: session.id } });
    if (existing) {
      const resumed = await this.resume(existing);
      if (resumed) return ok(resumed);
      // The manager forgot the sandbox: the old run is dead. Fall through to a fresh one.
    }

    const liveForClient = await this.prisma.labRun.count({
      where: { session: { clientHash: session.clientHash } },
    });
    if (liveForClient >= this.config.LAB_RUNS_PER_CLIENT) return err('client-limit');

    const run = await this.prisma.labRun.create({
      data: { sessionId: session.id, labId },
    });
    try {
      const sandbox = await this.manager.create({ requestId: run.id, seed: lab.setup });
      // Bind the sandbox before anything else looks at the run: the watcher, a claim and a
      // resume all key off sandboxId, and the manager already owns this id.
      const bound = await this.prisma.labRun.update({
        where: { id: run.id },
        data: { sandboxId: sandbox.id },
      });
      const synced = await this.sync(bound, sandbox);
      return ok(synced ?? this.view(bound, sandbox));
    } catch (error) {
      await this.prisma.labRun.delete({ where: { id: run.id } }).catch(() => undefined);
      if (error instanceof ManagerAtCapacityError) return err('capacity');
      throw error;
    }
  }

  /** The current run's status for a session, or null when it has none. */
  async status(sessionId: string): Promise<LabRunView | null> {
    const run = await this.prisma.labRun.findUnique({ where: { sessionId } });
    if (!run || !run.sandboxId) return run ? this.pending(run) : null;
    const sandbox = await this.manager.get(run.sandboxId);
    if (!sandbox) return null;
    return (await this.sync(run, sandbox)) ?? this.view(run, sandbox);
  }

  /** First heartbeat after the browser sees READY: claims the sandbox (→ ACTIVE). */
  async claim(sessionId: string): Promise<Result<LabRunView, RunRefusal>> {
    const run = await this.prisma.labRun.findUnique({ where: { sessionId } });
    if (!run || !run.sandboxId) return err('no-run');
    const sandbox = await this.manager.heartbeat(run.sandboxId);
    if (!sandbox) {
      await this.finish(run, 'ended', { releaseManager: false });
      return err('no-run');
    }
    this.lastHeartbeat.set(run.id, Date.now());
    return ok((await this.sync(run, sandbox)) ?? this.view(run, sandbox));
  }

  /** Runs one search through the mini-app on the run's sandbox. */
  async runApp(
    sessionId: string,
    input: string,
    mode: SearchMode,
  ): Promise<Result<{ text: string; values: readonly string[]; result: AppResult }, RunRefusal>> {
    const acquired = await this.acquire(sessionId);
    if (!acquired.ok) return err(acquired.error);
    const built = buildSearch(input, mode);
    const result = await acquired.value.connection.runApp(built, this.resultLimits());
    void this.keepAlive(acquired.value.run).catch(() => undefined);
    return ok({ text: built.text, values: built.values, result });
  }

  /** Runs the learner's own SQL on the run's sandbox — the same engine as T0 and T1. */
  async runConsole(sessionId: string, sql: string): Promise<Result<ScriptResult, RunRefusal>> {
    const acquired = await this.acquire(sessionId);
    if (!acquired.ok) return err(acquired.error);
    const connection = acquired.value.connection;
    const result = await connection.runConsole(async (dbSession) => {
      const previous = connection.snapshot;
      const outcome = await runScript(dbSession, sql, { limits: this.resultLimits(), previous });
      if (outcome.schema) connection.snapshot = outcome.schema.snapshot;
      return outcome;
    });
    void this.keepAlive(acquired.value.run).catch(() => undefined);
    // A T2 console never touches the session's T1 schema, so it publishes nothing on the
    // session stream (decision 8): the caller already has the diff in the response.
    return ok(result);
  }

  /** The learner released the lab. Idempotent. */
  async release(sessionId: string): Promise<boolean> {
    const run = await this.prisma.labRun.findUnique({ where: { sessionId } });
    if (!run) return false;
    await this.finish(run, 'released', { releaseManager: true });
    return true;
  }

  /** Ends a run and destroys its sandbox: the user released it, or its session ended. */
  async endRun(run: LabRun, reason: string): Promise<void> {
    await this.finish(run, reason, { releaseManager: true });
  }

  /**
   * Every run the watcher should look at, with just enough of the owning session to tell a
   * run whose session has ended. Kept to runs the manager has accepted.
   */
  liveRuns(): Promise<(LabRun & { session: { status: string } })[]> {
    return this.prisma.labRun.findMany({
      where: { sandboxId: { not: null } },
      include: { session: { select: { status: true } } },
    });
  }

  /**
   * Reconciles one run against the manager and returns its fresh view, or null once it has
   * ended (which cleans it up). This is the one place status transitions are published, so
   * the watcher and the user-facing calls all notify consistently.
   */
  async sync(run: LabRun, sandbox: ManagerSandbox): Promise<LabRunView | null> {
    const status = liveStatusOf(sandbox.status);
    if (status === 'ended') {
      await this.finish(run, sandbox.endReason ?? sandbox.failure ?? 'ended', {
        releaseManager: false,
      });
      return null;
    }
    if (sandbox.connection) this.connectionOf.set(run.id, sandbox.connection);

    if (status !== run.status) {
      run = await this.prisma.labRun.update({ where: { id: run.id }, data: { status } });
      if (status === 'READY') this.bus.publish(run.sessionId, { type: 'lab-ready' });
    }
    if (status === 'PENDING' && sandbox.queuePosition !== null) {
      this.bus.publish(run.sessionId, { type: 'lab-queued', position: sandbox.queuePosition });
    }
    return this.view(run, sandbox);
  }

  /** Tears a run down: release the manager if asked, drop the connection, delete the row. */
  private async finish(
    run: LabRun,
    reason: string,
    options: { releaseManager: boolean },
  ): Promise<void> {
    if (options.releaseManager && run.sandboxId) {
      await this.manager.release(run.sandboxId).catch((error: Error) => {
        this.logger.warn(`releasing sandbox ${run.sandboxId} failed: ${error.message}`);
      });
    }
    await this.connections.release(run.id);
    this.connectionOf.delete(run.id);
    this.lastHeartbeat.delete(run.id);
    await this.prisma.labRun.delete({ where: { id: run.id } }).catch(() => undefined);
    this.bus.publish(run.sessionId, { type: 'lab-ended', reason });
  }

  /** Resolves the run to an open connection, or a refusal if it is not usable yet. */
  private async acquire(
    sessionId: string,
  ): Promise<
    Result<{ run: LabRun; connection: Awaited<ReturnType<LabConnections['acquire']>> }, RunRefusal>
  > {
    const run = await this.prisma.labRun.findUnique({ where: { sessionId } });
    if (!run || !run.sandboxId) return err('no-run');
    if (run.status !== 'READY' && run.status !== 'ACTIVE') return err('not-ready');

    let connection = this.connectionOf.get(run.id);
    if (!connection) {
      // The API restarted, or never saw READY: ask the manager where the sandbox is.
      const sandbox = await this.manager.get(run.sandboxId);
      if (!sandbox?.connection) {
        if (!sandbox || liveStatusOf(sandbox.status) === 'ended') {
          await this.finish(run, 'ended', { releaseManager: false });
        }
        return err('not-ready');
      }
      connection = sandbox.connection;
      this.connectionOf.set(run.id, connection);
    }
    return ok({ run, connection: await this.connections.acquire(run.id, connection) });
  }

  /** Coalesced heartbeat: keeps the sandbox and the owning session alive while in use. */
  private async keepAlive(run: LabRun): Promise<void> {
    const now = Date.now();
    if (now - (this.lastHeartbeat.get(run.id) ?? 0) < HEARTBEAT_INTERVAL_MS) return;
    this.lastHeartbeat.set(run.id, now);
    if (run.sandboxId) await this.manager.heartbeat(run.sandboxId).catch(() => null);
    const session = await this.prisma.session.findUnique({ where: { id: run.sessionId } });
    if (session) await this.sessions.touch(session).catch(() => undefined);
  }

  /** Reloads a run whose sandbox the manager still knows; null if the manager forgot it. */
  private async resume(run: LabRun): Promise<LabRunView | null> {
    if (!run.sandboxId) return this.pending(run);
    const sandbox = await this.manager.get(run.sandboxId);
    if (!sandbox) {
      await this.finish(run, 'ended', { releaseManager: false });
      return null;
    }
    return this.sync(run, sandbox);
  }

  private view(run: LabRun, sandbox: ManagerSandbox): LabRunView {
    return {
      labId: run.labId,
      status: liveStatusOf(sandbox.status) === 'ended' ? 'ACTIVE' : (run.status as LiveStatus),
      queuePosition: sandbox.queuePosition,
      expiresAt: sandbox.expiresAt,
      idleExpiresAt: sandbox.idleExpiresAt,
    };
  }

  /** The brief window before the manager has accepted the request. */
  private pending(run: LabRun): LabRunView {
    return {
      labId: run.labId,
      status: run.status as LiveStatus,
      queuePosition: null,
      expiresAt: null,
      idleExpiresAt: null,
    };
  }

  private resultLimits() {
    return { maxRows: this.config.RESULT_MAX_ROWS, maxBytes: this.config.RESULT_MAX_BYTES };
  }
}
