import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '../../migrations');

/** Arbitrary and fixed: serializes two replicas that boot at the same time. */
const MIGRATION_LOCK = 7_302_210_001;

/**
 * Applies the `NNN_name.sql` files not applied yet, in name order, each in its own
 * transaction. Plain SQL on purpose: the schema is two tables, and the manager does not
 * need an ORM to own them.
 */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const done = new Set(
      (await client.query<{ name: string }>('select name from schema_migrations')).rows.map(
        (row) => row.name,
      ),
    );
    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files.filter((f) => !done.has(f))) {
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed`, { cause: error });
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}
