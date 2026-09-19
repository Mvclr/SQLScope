import type { PGliteInterface } from '@electric-sql/pglite';
import type { SqlExecutor } from '../executor.js';

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
