import type { SchemaSnapshot } from '@sqlscope/core';
import type { QueryAnalysis, ScriptResult } from '@sqlscope/engine';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** Event types of the session log (ADR 0004). */
export type SessionEventType =
  'StatementExecuted' | 'StatementFailed' | 'SchemaChanged' | 'SnapshotTaken' | 'QueryAnalyzed';

export interface HistoryEntry {
  readonly seq: number;
  readonly type: SessionEventType;
  readonly at: string;
  readonly payload: unknown;
}

/** Longer statements are kept truncated: history is for reading, not for replaying files. */
const MAX_LOGGED_SQL = 10_000;

/**
 * Append-only log of what happened in a session. The sandbox database stays the source
 * of truth for data; the log is the observable record of statements and schema changes.
 */
export class SessionLog {
  constructor(private readonly prisma: PrismaClient) {}

  async recordScript(sessionId: string, result: ScriptResult): Promise<void> {
    const events: { type: SessionEventType; payload: unknown }[] = result.statements.map(
      (statement) =>
        statement.status === 'ok'
          ? {
              type: 'StatementExecuted',
              payload: {
                sql: statement.text.slice(0, MAX_LOGGED_SQL),
                kind: statement.kind,
                command: statement.output.command,
                rowCount: statement.output.rowCount,
                durationMs: statement.durationMs,
              },
            }
          : {
              type: 'StatementFailed',
              payload: {
                sql: statement.text.slice(0, MAX_LOGGED_SQL),
                kind: statement.kind,
                code: statement.error.code,
                message: statement.error.message,
                durationMs: statement.durationMs,
              },
            },
    );
    if (result.schema && result.schema.changes.length > 0) {
      events.push({ type: 'SchemaChanged', payload: { changes: result.schema.changes } });
    }
    if (result.schema) {
      // Checkpoint: the next script diffs against it, even after an API restart.
      events.push({ type: 'SnapshotTaken', payload: { snapshot: result.schema.snapshot } });
    }
    await this.append(sessionId, events);
  }

  async recordSnapshot(sessionId: string, snapshot: SchemaSnapshot): Promise<void> {
    await this.append(sessionId, [{ type: 'SnapshotTaken', payload: { snapshot } }]);
  }

  /** Keeps a measurement, so a later run of the same query can be compared with it. */
  async recordAnalysis(sessionId: string, analysis: QueryAnalysis): Promise<void> {
    await this.append(sessionId, [{ type: 'QueryAnalyzed', payload: analysis }]);
  }

  /** The most recent measurement of a query shape in this session, if there is one. */
  async lastAnalysis(sessionId: string, fingerprint: string): Promise<QueryAnalysis | null> {
    const event = await this.prisma.sessionEvent.findFirst({
      where: {
        sessionId,
        type: 'QueryAnalyzed',
        payload: { path: ['fingerprint'], equals: fingerprint },
      },
      orderBy: { seq: 'desc' },
    });
    return (event?.payload as QueryAnalysis | undefined) ?? null;
  }

  async latestSnapshot(sessionId: string): Promise<SchemaSnapshot | null> {
    const event = await this.prisma.sessionEvent.findFirst({
      where: { sessionId, type: 'SnapshotTaken' },
      orderBy: { seq: 'desc' },
    });
    return (event?.payload as { snapshot: SchemaSnapshot } | undefined)?.snapshot ?? null;
  }

  /** Statements and schema changes, oldest first. Checkpoints are an internal detail. */
  async history(sessionId: string, limit = 500): Promise<HistoryEntry[]> {
    const events = await this.prisma.sessionEvent.findMany({
      // Checkpoints and measurements are internal: the history lists what the user ran.
      where: { sessionId, type: { notIn: ['SnapshotTaken', 'QueryAnalyzed'] } },
      orderBy: { seq: 'desc' },
      take: limit,
    });
    return events.reverse().map((e) => ({
      seq: e.seq,
      type: e.type as SessionEventType,
      at: e.createdAt.toISOString(),
      payload: e.payload,
    }));
  }

  /** Callers serialise per session (SessionConnection.exclusive), so `max + 1` is safe. */
  private async append(
    sessionId: string,
    events: readonly { type: SessionEventType; payload: unknown }[],
  ): Promise<void> {
    if (events.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      const last = await tx.sessionEvent.aggregate({ where: { sessionId }, _max: { seq: true } });
      const next = (last._max.seq ?? 0) + 1;
      await tx.sessionEvent.createMany({
        data: events.map((event, i) => ({
          sessionId,
          seq: next + i,
          type: event.type,
          payload: event.payload as Prisma.InputJsonValue,
        })),
      });
    });
  }
}
