import type { PGliteInterface } from '@electric-sql/pglite';
import { introspect, type SchemaSnapshot } from '@sqlscope/core';
import { pgliteSession } from '@sqlscope/core/pglite';
import type { WorkspaceBackend } from './backend';

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
    async close() {
      await db?.close();
      db = undefined;
    },
  };
}
