import { Logger } from '@nestjs/common';
import {
  asDatabaseError,
  type ResultLimits,
  type SchemaSnapshot,
  type SqlSession,
} from '@sqlscope/core';
import { pgSession } from '@sqlscope/core/pg';
import type { BuiltQuery } from '@sqlscope/labs';
import pg from 'pg';

const logger = new Logger('LabConnections');

/** Leaves every value as the text PostgreSQL sent, like the T1 path. */
const rawText = { getTypeParser: () => (value: string) => value };

/** How the API reaches a ready sandbox, as the manager reported it. */
export interface SandboxConnection {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

/** The mini-app's answer: rows to show, or the database's own rejection, by SQLSTATE. */
export type AppResult =
  | { readonly ok: true; readonly columns: string[]; readonly rows: (string | null)[][] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/**
 * The connection comes from the manager, an authenticated internal service, so this is
 * defence in depth, not the main control: the host must look like a bare hostname or IP —
 * in production `sqlscope-t2-<id>` — with none of the characters that would let it carry a
 * path, port or credentials of its own into the URL.
 */
const PLAIN_HOST = /^[a-zA-Z0-9.-]{1,255}$/;

function connectionString(c: SandboxConnection): string {
  if (!PLAIN_HOST.test(c.host)) throw new Error(`unexpected sandbox host: ${c.host}`);
  if (!Number.isInteger(c.port) || c.port <= 0 || c.port > 65_535) {
    throw new Error(`unexpected sandbox port: ${c.port}`);
  }
  const url = new URL('postgresql://');
  url.hostname = c.host;
  url.port = String(c.port);
  url.username = c.user;
  url.password = c.password;
  url.pathname = `/${c.database}`;
  return url.toString();
}

/**
 * Two pinned connections to one sandbox: the learner's console and the mini-app. Separate
 * so a transaction the learner left open on the console never swallows the app's searches.
 *
 * The API is not superuser on a T2 sandbox — it has no admin connection there at all. So the
 * time limit is enforced from a second connection as the *same* `lab` role: PostgreSQL lets
 * a role cancel its own backends, which is all the watchdog needs.
 */
export class LabConnection {
  /** Last schema the console saw, to diff the next script against. */
  snapshot: SchemaSnapshot | null = null;
  private consoleQueue: Promise<unknown> = Promise.resolve();
  private appQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly consoleClient: pg.Client,
    private readonly consolePid: number,
    private readonly appClient: pg.Client,
    private readonly appPid: number,
    private readonly connString: string,
    private readonly limitMs: number,
  ) {}

  /** Runs `work` with the watched console session, serialized against other console work. */
  runConsole<T>(work: (session: SqlSession) => Promise<T>): Promise<T> {
    const session = this.watched(pgSession(this.consoleClient), this.consolePid);
    const run = this.consoleQueue.then(() => work(session));
    this.consoleQueue = run.catch(() => undefined);
    return run;
  }

  /** Runs one built search on the app connection, serialized against other app work. */
  runApp(built: BuiltQuery, limits: ResultLimits): Promise<AppResult> {
    const run = this.appQueue.then(() => this.execApp(built, limits));
    this.appQueue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    await Promise.all([
      this.consoleClient.end().catch(() => undefined),
      this.appClient.end().catch(() => undefined),
    ]);
  }

  private async execApp(built: BuiltQuery, limits: ResultLimits): Promise<AppResult> {
    let fired = false;
    const watchdog = setTimeout(() => {
      fired = true;
      void this.cancel(this.appPid);
    }, this.limitMs + 500);
    try {
      const result = await this.appClient.query<(string | null)[]>({
        text: built.text,
        values: [...built.values],
        rowMode: 'array',
        types: rawText,
      });
      return {
        ok: true,
        columns: result.fields.map((f) => f.name),
        rows: result.rows.slice(0, limits.maxRows),
      };
    } catch (error) {
      const dbError = asDatabaseError(error);
      if (!dbError) throw error;
      const message =
        fired && dbError.code === '57014'
          ? `canceling statement: exceeded the ${this.limitMs} ms limit`
          : dbError.message;
      return { ok: false, error: { code: dbError.code, message } };
    } finally {
      clearTimeout(watchdog);
    }
  }

  /** The same watchdog the T1 path uses (session-connections), enforced without superuser. */
  private watched(session: SqlSession, pid: number): SqlSession {
    return {
      ...session,
      execute: async (sql, limits) => {
        let fired = false;
        const watchdog = setTimeout(() => {
          fired = true;
          void this.cancel(pid);
        }, this.limitMs + 500);
        try {
          return await session.execute(sql, limits);
        } catch (error) {
          if (fired && asDatabaseError(error)?.code === '57014') {
            (error as Error).message = `canceling statement: exceeded the ${this.limitMs} ms limit`;
          }
          throw error;
        } finally {
          clearTimeout(watchdog);
        }
      },
    };
  }

  private async cancel(pid: number): Promise<void> {
    const canceller = new pg.Client({
      connectionString: this.connString,
      application_name: 'sqlscope-lab-cancel',
    });
    try {
      await canceller.connect();
      await canceller.query('select pg_cancel_backend($1)', [pid]);
    } catch (error) {
      logger.error(`could not cancel backend ${pid}: ${(error as Error).message}`);
    } finally {
      await canceller.end().catch(() => undefined);
    }
  }
}

/** One pinned pair of connections per live lab run, opened on demand and dropped on release. */
export class LabConnections {
  private readonly connections = new Map<string, Promise<LabConnection>>();

  constructor(private readonly statementTimeoutMs: number) {}

  acquire(runId: string, connection: SandboxConnection): Promise<LabConnection> {
    let existing = this.connections.get(runId);
    if (!existing) {
      existing = this.open(runId, connection);
      existing.catch(() => this.connections.delete(runId));
      this.connections.set(runId, existing);
    }
    return existing;
  }

  async release(runId: string): Promise<void> {
    const connection = this.connections.get(runId);
    this.connections.delete(runId);
    await (await connection?.catch(() => undefined))?.close();
  }

  async releaseAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((id) => this.release(id)));
  }

  private async open(runId: string, connection: SandboxConnection): Promise<LabConnection> {
    const connString = connectionString(connection);
    const consoleClient = this.client(connString, 'sqlscope-lab-console', runId);
    const appClient = this.client(connString, 'sqlscope-lab-app', runId);
    await Promise.all([consoleClient.connect(), appClient.connect()]);
    const [consolePid, appPid] = await Promise.all([
      backendPid(consoleClient),
      backendPid(appClient),
    ]);
    return new LabConnection(
      consoleClient,
      consolePid,
      appClient,
      appPid,
      connString,
      this.statementTimeoutMs,
    );
  }

  /** A lost connection (the sandbox was destroyed) drops the pair; the next acquire reopens. */
  private client(connString: string, name: string, runId: string): pg.Client {
    const client = new pg.Client({ connectionString: connString, application_name: name });
    client.on('error', (error) => {
      logger.warn(`lab run ${runId}: ${name} connection lost — ${error.message}`);
      void this.release(runId);
    });
    client.on('end', () => void this.release(runId));
    return client;
  }
}

async function backendPid(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
  return rows[0]!.pid;
}
