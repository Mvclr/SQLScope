import { Inject, Injectable } from '@nestjs/common';
import { runScript, type ScriptResult } from '@sqlscope/engine';
import { CONFIG, type Config } from '../config.js';
import { SessionEventBus } from '../events/session-event-bus.js';
import { SessionLog } from '../events/session-log.js';
import type { Session } from '../generated/prisma/client.js';
import { SessionConnections } from '../sandbox/session-connections.js';
import { SessionService } from '../sessions/session.service.js';

@Injectable()
export class ExecutionService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly connections: SessionConnections,
    private readonly sessions: SessionService,
    private readonly log: SessionLog,
    private readonly bus: SessionEventBus,
  ) {}

  /** Runs a user script in the session's sandbox — the same engine the browser runs in T0. */
  async execute(session: Session, sql: string): Promise<ScriptResult> {
    const connection = await this.connections.acquire(session.id, {
      databaseName: session.databaseName,
      password: session.rolePassword,
    });

    return connection.exclusive(async () => {
      connection.snapshot ??= await this.log.latestSnapshot(session.id);
      const result = await runScript(connection.session, sql, {
        limits: { maxRows: this.config.RESULT_MAX_ROWS, maxBytes: this.config.RESULT_MAX_BYTES },
        previous: connection.snapshot,
      });

      if (result.schema) connection.snapshot = result.schema.snapshot;
      await this.log.recordScript(session.id, result);
      if (result.schema && result.schema.changes.length > 0) {
        this.bus.publish(session.id, { type: 'schema-changed', ...result.schema });
      }
      await this.sessions.touch(session);
      return result;
    });
  }
}
