import type { ClientBase } from 'pg';
import type { SqlExecutor } from '../executor.js';

/**
 * Adapts a single node-postgres connection (T1/T2) to `SqlExecutor`.
 *
 * Takes a client, not a pool: a pool may hand consecutive queries to different
 * connections, which would break the executor's single-session contract.
 */
export function pgExecutor(client: ClientBase): SqlExecutor {
  return {
    async query(sql, params) {
      const result = await client.query<never>(sql, params ? [...params] : undefined);
      return {
        rows: result.rows,
        fields: result.fields.map((f) => ({ name: f.name, dataTypeId: f.dataTypeID })),
      };
    },
  };
}
