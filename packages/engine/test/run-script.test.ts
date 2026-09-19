import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import type { SchemaSnapshot, SqlSession } from '@sqlscope/core';
import { pgliteSession } from '@sqlscope/core/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runScript, type ScriptResult } from '../src/index.js';

const limits = { maxRows: 100, maxBytes: 100_000 };

let template: PGlite;
let db: PGliteInterface | undefined;

beforeAll(async () => {
  template = await PGlite.create();
}, 60_000);

afterAll(async () => {
  await template?.close();
});

afterEach(async () => {
  await db?.close();
  db = undefined;
});

const session = async (): Promise<SqlSession> => {
  const clone = await template.clone();
  db = clone;
  return pgliteSession(clone);
};

const statuses = (result: ScriptResult) => result.statements.map((s) => s.status);

describe('runScript', () => {
  it('runs every statement and reports each one separately', async () => {
    const s = await session();

    const result = await runScript(
      s,
      `create table t (id int); insert into t values (1), (2); select * from t order by id`,
      { limits, previous: null },
    );

    expect(result.syntaxError).toBeNull();
    expect(result.statements.map((r) => [r.kind, r.status])).toEqual([
      ['ddl', 'ok'],
      ['dml', 'ok'],
      ['read', 'ok'],
    ]);
    expect(result.statements[2]).toMatchObject({
      text: 'select * from t order by id',
      output: { rows: [['1'], ['2']] },
    });
  });

  it('executes nothing when the script does not parse', async () => {
    const s = await session();

    const result = await runScript(s, `create table t (id int); selec 1`, {
      limits,
      previous: null,
    });

    expect(result.syntaxError?.message).toMatch(/syntax error/);
    expect(result.statements).toEqual([]);
    expect(
      await runScript(s, `select count(*) from pg_tables where tablename = 't'`, {
        limits,
        previous: null,
      }),
    ).toMatchObject({ statements: [{ output: { rows: [['0']] } }] });
  });

  it('stops at the first failure and points at the offending token in the script', async () => {
    const s = await session();
    const sql = `select 'João';\nselect * from missing;\nselect 3`;

    const result = await runScript(s, sql, { limits, previous: null });

    expect(statuses(result)).toEqual(['ok', 'error']);
    expect(result.skipped).toBe(1);
    const failed = result.statements[1];
    if (failed?.status !== 'error') throw new Error('expected a failure');
    expect(failed.error.code).toBe('42P01');
    expect(sql.slice(failed.error.scriptPosition!)).toMatch(/^missing/);
  });

  it('keeps the effect of statements that ran before a failure', async () => {
    const s = await session();

    const result = await runScript(s, `create table kept (id int); select 1/0`, {
      limits,
      previous: { tables: [] },
    });

    expect(statuses(result)).toEqual(['ok', 'error']);
    expect(result.schema?.changes.map((c) => c.type)).toEqual(['table-created']);
  });

  it('only reads the schema when something that ran could have changed it', async () => {
    const s = await session();
    const previous: SchemaSnapshot = { tables: [] };

    const reads = await runScript(s, `select 1; set search_path = public`, {
      limits,
      previous,
    });
    expect(reads.schema).toBeNull();
    expect(reads.schemaUnknown).toBe(false);

    const ddl = await runScript(s, `create table t (id int)`, { limits, previous });
    expect(ddl.schema?.changes).toMatchObject([{ type: 'table-created', table: { name: 't' } }]);
  });

  it('reports the schema as unknown inside a failed transaction, then recovers', async () => {
    const s = await session();

    const failed = await runScript(s, `begin; create table t (id int); select 1/0`, {
      limits,
      previous: { tables: [] },
    });
    expect(failed.schemaUnknown).toBe(true);
    expect(failed.schema).toBeNull();

    const rolledBack = await runScript(s, `rollback`, { limits, previous: { tables: [] } });
    expect(rolledBack.schemaUnknown).toBe(false);
    expect(rolledBack.schema).toEqual({ snapshot: { tables: [] }, changes: [] });
  });

  it('diffs against the previous snapshot it is given', async () => {
    const s = await session();
    const first = await runScript(s, `create table a (id int)`, { limits, previous: null });

    const second = await runScript(s, `alter table a add column name text`, {
      limits,
      previous: first.schema!.snapshot,
    });

    expect(second.schema?.changes).toMatchObject([
      { type: 'column-added', column: { name: 'name' } },
    ]);
  });
});
