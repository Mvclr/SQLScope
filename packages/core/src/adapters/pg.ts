import type { ClientBase, CustomTypesConfig } from 'pg';
import Cursor from 'pg-cursor';
import type { SqlExecutor } from '../executor.js';
import { completeOutput, RowCollector, type SqlSession } from '../session.js';

/** Leaves every value as the text PostgreSQL sent. */
const rawText: CustomTypesConfig = { getTypeParser: () => (value: string) => value };

const BATCH_SIZE = 200;

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

/**
 * `SqlSession` over a node-postgres connection. Results are read through a cursor in
 * batches, so a `SELECT` over millions of rows costs the server `maxRows`, not the table.
 */
export function pgSession(client: ClientBase): SqlSession {
  return {
    ...pgExecutor(client),
    async execute(sql, limits) {
      const cursor = client.query(
        new Cursor<string[]>(sql, [], { rowMode: 'array', types: rawText }),
      );
      const collected = new RowCollector(limits);
      try {
        for (;;) {
          const rows = await cursor.read(BATCH_SIZE);
          if (!rows.every((row) => collected.add(row))) break;
          if (rows.length < BATCH_SIZE) break;
        }
        // pg-cursor keeps the command tag and fields on its (untyped) result object.
        const result = (cursor as unknown as { _result: CursorResult })._result;
        return completeOutput(
          collected,
          result.fields.map((f) => ({ name: f.name, typeId: f.dataTypeID })),
          result.command,
          result.rowCount,
        );
      } finally {
        await cursor.close();
      }
    },
  };
}

interface CursorResult {
  command: string | null;
  rowCount: number | null;
  fields: { name: string; dataTypeID: number }[];
}
