import { Inject, Injectable } from '@nestjs/common';
import { introspect, readPrivileges } from '@sqlscope/core';
import { analyzeQuery, type QueryAnalysis } from '@sqlscope/engine';
import { analyze, type Report } from '@sqlscope/security-rules';
import { CONFIG, type Config } from '../config.js';
import { SessionLog } from '../events/session-log.js';
import type { Session } from '../generated/prisma/client.js';
import { SessionConnections } from '../sandbox/session-connections.js';
import { SessionService } from '../sessions/session.service.js';

export interface AnalysisWithHistory {
  readonly analysis: QueryAnalysis;
  /** Last measurement of the same query shape, when there is one to compare against. */
  readonly previous: QueryAnalysis | null;
}

@Injectable()
export class AnalysisService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly connections: SessionConnections,
    private readonly sessions: SessionService,
    private readonly log: SessionLog,
  ) {}

  /**
   * Explains a query, measures it when it only reads, and hands back the previous
   * measurement of the same query so the user can see what a change did.
   */
  async analyzeQuery(session: Session, sql: string, runs?: number) {
    const connection = await this.connections.acquire(session.id, {
      databaseName: session.databaseName,
      password: session.rolePassword,
    });

    return connection.exclusive(async () => {
      const result = await analyzeQuery(
        connection.session,
        sql,
        runs === undefined ? {} : { runs },
      );
      if (!result.ok) return result;

      const analysis = result.value;
      const previous = await this.log.lastAnalysis(session.id, analysis.fingerprint);
      await this.log.recordAnalysis(session.id, analysis);
      await this.sessions.touch(session);
      return { ...result, value: { analysis, previous } satisfies AnalysisWithHistory };
    });
  }

  /** Runs every security rule against the session's database (ADR 0006). */
  async report(session: Session): Promise<Report> {
    const connection = await this.connections.acquire(session.id, {
      databaseName: session.databaseName,
      password: session.rolePassword,
    });

    return connection.exclusive(async () => {
      const snapshot = await introspect(connection.session);
      const privileges = await readPrivileges(connection.session);
      await this.sessions.touch(session);
      return analyze({ snapshot, privileges });
    });
  }

  get limits() {
    return { statementTimeoutMs: this.config.STATEMENT_TIMEOUT_MS };
  }
}
