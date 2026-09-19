import { Logger } from '@nestjs/common';
import { asDatabaseError, type SchemaSnapshot, type SqlSession } from '@sqlscope/core';
import { pgSession } from '@sqlscope/core/pg';
import pg from 'pg';
import { SandboxProvisioner, type SandboxCredentials } from './provisioner.js';

const logger = new Logger('SessionConnections');

/** A user's live connection to their sandbox, and what the API remembers about it. */
export class SessionConnection {
  /** Last schema seen, to diff the next script against. */
  snapshot: SchemaSnapshot | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly session: SqlSession,
    private readonly client: pg.Client,
  ) {}

  /**
   * Runs `work` once the previous work on this connection has finished. A session is one
   * PostgreSQL backend: two browser tabs must take turns, not interleave statements.
   */
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    await this.client.end().catch(() => undefined);
  }
}

/**
 * Keeps one pinned connection per active session. Pinned, not pooled: a user's `BEGIN`
 * in one request and `COMMIT` in the next must reach the same backend.
 *
 * Single-process by design for now — a second API instance would need sticky routing.
 */
export class SessionConnections {
  private readonly connections = new Map<string, Promise<SessionConnection>>();

  constructor(
    private readonly admin: pg.Pool,
    private readonly adminUrl: string,
    private readonly statementTimeoutMs: number,
  ) {}

  acquire(sessionId: string, credentials: SandboxCredentials): Promise<SessionConnection> {
    let connection = this.connections.get(sessionId);
    if (!connection) {
      connection = this.open(sessionId, credentials);
      connection.catch(() => this.connections.delete(sessionId));
      this.connections.set(sessionId, connection);
    }
    return connection;
  }

  async release(sessionId: string): Promise<void> {
    const connection = this.connections.get(sessionId);
    this.connections.delete(sessionId);
    await (await connection?.catch(() => undefined))?.close();
  }

  async releaseAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((id) => this.release(id)));
  }

  private async open(sessionId: string, credentials: SandboxCredentials) {
    const client = new pg.Client({
      connectionString: SandboxProvisioner.connectionString(this.adminUrl, credentials),
      application_name: 'sqlscope-session',
    });
    // The server ends this connection when the reaper drops the database; forget it
    // instead of crashing (see createPool).
    client.on('error', (error) => {
      logger.warn(`session ${sessionId}: connection lost — ${error.message}`);
      this.connections.delete(sessionId);
    });
    client.on('end', () => this.connections.delete(sessionId));
    await client.connect();
    const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid');

    return new SessionConnection(this.watched(pgSession(client), rows[0]!.pid), client);
  }

  /**
   * `statement_timeout` is only the role's default: any user can `SET` it to zero. The
   * limit that holds is this one — past it, the API cancels the backend from outside,
   * as the provisioner, which the user cannot prevent.
   */
  private watched(session: SqlSession, pid: number): SqlSession {
    const limitMs = this.statementTimeoutMs;
    return {
      ...session,
      execute: async (sql, limits) => {
        let fired = false;
        const watchdog = setTimeout(() => {
          fired = true;
          this.admin.query('select pg_cancel_backend($1)', [pid]).catch((error: Error) => {
            logger.error(`could not cancel backend ${pid}: ${error.message}`);
          });
        }, limitMs + 500);
        try {
          return await session.execute(sql, limits);
        } catch (error) {
          if (fired && asDatabaseError(error)?.code === '57014') {
            (error as Error).message = `canceling statement: exceeded the ${limitMs} ms limit`;
          }
          throw error;
        } finally {
          clearTimeout(watchdog);
        }
      },
    };
  }
}
