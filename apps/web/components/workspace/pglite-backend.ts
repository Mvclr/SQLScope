import type { PGliteInterface } from '@electric-sql/pglite';
import { introspect, readPrivileges, type SchemaSnapshot } from '@sqlscope/core';
import { pgliteSession } from '@sqlscope/core/pglite';
import type { QueryAnalysis } from '@sqlscope/engine';
import { BackendError, type WorkspaceBackend } from './backend';

/** Generous: in T0 the only machine at risk is the user's own. */
const limits = { maxRows: 5_000, maxBytes: 5_000_000 };

export interface DatabaseSetup {
  readonly schema: string;
  readonly seed: string;
}

/** Loaded on demand: PGlite is several megabytes of WebAssembly. */
export async function createPGlite(): Promise<PGliteInterface> {
  const { PGlite } = await import('@electric-sql/pglite');
  return PGlite.create();
}

/** T0: PostgreSQL compiled to WebAssembly, running in this tab (ADR 0001). */
export function pgliteBackend(setup?: DatabaseSetup): WorkspaceBackend {
  let db: PGliteInterface | undefined;
  let snapshot: SchemaSnapshot = { tables: [] };
  // Measurements taken in this workspace, so a query can be compared with its own last run.
  const measured = new Map<string, QueryAnalysis>();

  const session = () => {
    if (!db) throw new Error('Database is not open');
    return pgliteSession(db);
  };

  return {
    tier: 'T0',
    async open() {
      db = await createPGlite();
      if (setup) {
        await db.exec(setup.schema);
        await db.exec(setup.seed);
      }
      snapshot = await introspect(session());
      return snapshot;
    },

    async execute(sql) {
      // Loaded on first use: the engine pulls in the SQL parser's WebAssembly, which is
      // not needed to render the page (and must not load during server rendering).
      const { runScript } = await import('@sqlscope/engine');
      const result = await runScript(session(), sql, { limits, previous: snapshot });
      if (result.schema) snapshot = result.schema.snapshot;
      return result;
    },

    async analyze(sql) {
      const { analyzeQuery } = await import('@sqlscope/engine');
      const result = await analyzeQuery(session(), sql, { runs: 3 });
      if (!result.ok) throw new BackendError(describeAnalysisError(result.error), 'unavailable');
      const previous = measured.get(result.value.fingerprint) ?? null;
      measured.set(result.value.fingerprint, result.value);
      return { analysis: result.value, previous };
    },

    async report() {
      const { analyze } = await import('@sqlscope/security-rules');
      const executor = session();
      return analyze({
        snapshot: await introspect(executor),
        privileges: await readPrivileges(executor),
      });
    },

    async close() {
      await db?.close();
      db = undefined;
    },
  };
}

function describeAnalysisError(error: { kind: string; message?: string }): string {
  if (error.kind === 'not-single-statement') return 'Analise uma consulta por vez.';
  return error.message ?? 'Não foi possível analisar a consulta.';
}
