import { beforeAll, describe, expect, it } from 'vitest';
import { loadParser, parseScript, type Classification } from '../src/index.js';

beforeAll(loadParser);

const classifyOne = (sql: string): Classification => {
  const result = parseScript(sql);
  if (!result.ok || result.value.length !== 1) throw new Error(`expected one statement: ${sql}`);
  const { nodeType, kind, changesCatalog, changesData, explained } = result.value[0]!;
  return { nodeType, kind, changesCatalog, changesData, ...(explained && { explained }) };
};

const shape = (sql: string) => {
  const { kind, changesCatalog, changesData } = classifyOne(sql);
  return [kind, changesCatalog, changesData];
};

describe('classify', () => {
  it.each([
    ['select * from users', 'read', false, false],
    ['select * from users for update', 'read', false, false],
    ['with t as (select 1) select * from t', 'read', false, false],
    ['copy users to stdout', 'read', false, false],
  ])('%s → read-only', (sql, ...expected) => {
    expect(shape(sql)).toEqual(expected);
  });

  it.each([
    ['insert into users values (1)', 'dml'],
    ['update users set name = null', 'dml'],
    ['delete from users', 'dml'],
    ['merge into t using s on t.id = s.id when matched then delete', 'dml'],
    ['truncate users', 'dml'],
    ['copy users from stdin', 'dml'],
    ['with gone as (delete from users returning *) select * from gone', 'dml'],
  ])('%s → changes data only', (sql, kind) => {
    expect(shape(sql)).toEqual([kind, false, true]);
  });

  it.each([
    'create table t (id int)',
    'alter table t add column x int',
    'drop table t',
    'create index i on t (id)',
    'create view v as select 1',
    'alter table t rename to u',
    "comment on table t is 'x'",
    "create type mood as enum ('ok')",
    'select * into copy_of_t from t',
  ])('%s → DDL', (sql) => {
    expect(shape(sql)).toEqual(['ddl', true, true]);
  });

  it.each([
    'grant select on t to analyst',
    'revoke insert on t from app',
    'create role analyst',
    'alter role analyst nologin',
    'create policy tenant on documents using (true)',
    'alter default privileges grant select on tables to analyst',
  ])('%s → DCL', (sql) => {
    expect(shape(sql)).toEqual(['dcl', true, false]);
  });

  it('treats DROP OWNED as also removing data', () => {
    expect(shape('drop owned by analyst')).toEqual(['dcl', true, true]);
  });

  it.each([
    ['begin', false],
    ['commit', false],
    ['savepoint a', false],
    ['rollback', true],
    ['rollback to savepoint a', true],
  ])('%s → transaction control (undoes changes: %s)', (sql, undoes) => {
    expect(shape(sql)).toEqual(['transaction', undoes, undoes]);
  });

  describe('explain', () => {
    it('does not execute without ANALYZE', () => {
      expect(classifyOne('explain delete from users')).toMatchObject({
        kind: 'explain',
        changesCatalog: false,
        changesData: false,
        explained: { kind: 'dml' },
      });
    });

    it.each(['explain analyze delete from users', 'explain (analyze) delete from users'])(
      '%s executes the statement',
      (sql) => {
        expect(shape(sql)).toEqual(['explain', false, true]);
      },
    );

    it.each(['false', 'off', '0'])('respects ANALYZE %s', (value) => {
      expect(shape(`explain (analyze ${value}) delete from users`)).toEqual([
        'explain',
        false,
        false,
      ]);
    });

    it('is harmless for a read even with ANALYZE', () => {
      expect(shape('explain analyze select 1')).toEqual(['explain', false, false]);
    });
  });

  it.each(['set statement_timeout = 1000', 'show search_path', 'vacuum t', "notify c, 'x'"])(
    '%s → inert utility',
    (sql) => {
      expect(shape(sql)).toEqual(['utility', false, false]);
    },
  );

  it.each(['do $$ begin perform 1; end $$', 'call p()', 'execute plan_1'])(
    '%s → opaque utility, assumed to change everything',
    (sql) => {
      expect(shape(sql)).toEqual(['utility', true, true]);
    },
  );
});
