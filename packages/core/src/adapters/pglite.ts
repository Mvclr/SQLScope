import type { PGliteInterface } from '@electric-sql/pglite';
import type { SqlExecutor } from '../executor.js';
import { completeOutput, RowCollector, type SqlSession } from '../session.js';

/** Adapts a PGlite instance (T0, in the browser) to `SqlExecutor`. */
export function pgliteExecutor(db: PGliteInterface): SqlExecutor {
  return {
    async query(sql, params) {
      const result = await db.query<never>(sql, params ? [...params] : undefined);
      return {
        rows: result.rows,
        fields: result.fields.map((f) => ({ name: f.name, dataTypeId: f.dataTypeID })),
      };
    },
  };
}

type Parsers = Record<number, (value: string) => string>;

const identity = (value: string) => value;

/**
 * PGlite parses every type it knows — built-ins, plus array types registered at startup —
 * and merges per-query `parsers` over its own with an object spread. So raw text needs an
 * explicit identity parser under every type oid; a catch-all Proxy would be spread away.
 */
async function rawTextParsers(db: PGliteInterface): Promise<Parsers> {
  const { rows } = await db.query<{ oid: number }>(
    'select oid::int as oid from pg_catalog.pg_type',
  );
  return Object.fromEntries(rows.map(({ oid }) => [oid, identity]));
}

/** `SqlSession` over PGlite. It runs in the user's own tab, so limits only protect the UI. */
export function pgliteSession(db: PGliteInterface): SqlSession {
  // Built before the first user statement runs, while the session is known to be clean.
  let parsers: Promise<Parsers> | undefined;
  return {
    ...pgliteExecutor(db),
    async execute(sql, limits) {
      parsers ??= rawTextParsers(db);
      const result = await db.query<(string | null)[]>(sql, [], {
        rowMode: 'array',
        parsers: await parsers,
      });
      const collected = new RowCollector(limits);
      for (const row of result.rows) if (!collected.add(row)) break;

      // Present at runtime, missing from PGlite's declared result type.
      const { command, rowCount } = result as { command?: string; rowCount?: number };
      return completeOutput(
        collected,
        result.fields.map((f) => ({ name: f.name, typeId: f.dataTypeID })),
        command,
        rowCount,
      );
    },
  };
}
