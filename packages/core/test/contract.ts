import { afterEach, describe, expect, it } from 'vitest';
import {
  diffSnapshots,
  introspect,
  type ForeignKeyConstraint,
  type SqlExecutor,
  type TableSnapshot,
} from '../src/index.js';

export interface TestDatabase {
  readonly db: SqlExecutor;
  dispose(): Promise<void>;
}

/**
 * Behaviour every engine must share. Run once per engine (PGlite, PostgreSQL) so that
 * any divergence between T0 and T1/T2 fails a test instead of reaching a user.
 */
export function describeEngineContract(
  engine: string,
  createDatabase: () => Promise<TestDatabase>,
): void {
  describe(`introspection contract — ${engine}`, () => {
    let current: TestDatabase | undefined;

    const fresh = async (...statements: string[]) => {
      current = await createDatabase();
      await run(current.db, ...statements);
      return current.db;
    };

    afterEach(async () => {
      await current?.dispose();
      current = undefined;
    });

    it('returns no tables for an empty database', async () => {
      const db = await fresh();
      expect(await introspect(db)).toEqual({ tables: [] });
    });

    it('describes columns, defaults, identity and generated columns', async () => {
      const db = await fresh(`
        create table users (
          id bigint generated always as identity primary key,
          email varchar(255) not null,
          name text,
          created_at timestamptz not null default now(),
          score numeric(10, 2) default 0,
          email_lower text generated always as (lower(email)) stored
        )`);

      const users = table(await introspect(db), 'public', 'users');

      expect(users.columns.map((c) => [c.name, c.dataType, c.nullable, c.default])).toEqual([
        ['id', 'bigint', false, null],
        ['email', 'character varying(255)', false, null],
        ['name', 'text', true, null],
        ['created_at', 'timestamp with time zone', false, 'now()'],
        ['score', 'numeric(10,2)', true, '0'],
        ['email_lower', 'text', true, null],
      ]);
      expect(users.columns.map((c) => c.position)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(users.columns[0]?.identity).toBe('always');
      expect(users.columns[5]?.generated).toEqual({
        kind: 'stored',
        expression: expect.stringContaining('lower(') as unknown as string,
      });
    });

    it('describes primary key, unique, foreign key and check constraints', async () => {
      const db = await fresh(
        `create table users (id int primary key, email text unique)`,
        `create table orders (
           id int primary key,
           user_id int not null references users (id) on delete cascade,
           total numeric check (total >= 0),
           constraint orders_user_id_id_key unique (user_id, id)
         )`,
      );

      const orders = table(await introspect(db), 'public', 'orders');

      expect(orders.constraints.map((c) => [c.name, c.kind, c.columns])).toEqual([
        ['orders_pkey', 'primary key', ['id']],
        ['orders_total_check', 'check', ['total']],
        ['orders_user_id_fkey', 'foreign key', ['user_id']],
        ['orders_user_id_id_key', 'unique', ['user_id', 'id']],
      ]);

      const fk = orders.constraints.find((c) => c.kind === 'foreign key') as ForeignKeyConstraint;
      expect(fk.references).toEqual({ schema: 'public', name: 'users', columns: ['id'] });
      expect(fk.onDelete).toBe('cascade');
      expect(fk.onUpdate).toBe('no action');

      const check = orders.constraints.find((c) => c.kind === 'check');
      expect(check).toMatchObject({ expression: 'total >= 0::numeric' });
    });

    it('describes indexes and the constraint each one implements', async () => {
      const db = await fresh(
        `create table products (id int primary key, sku text, name text, deleted_at timestamptz)`,
        `create unique index products_sku_active on products (sku) where deleted_at is null`,
        `create index products_name_lower on products (lower(name))`,
      );

      const products = table(await introspect(db), 'public', 'products');

      expect(
        products.indexes.map((i) => [i.name, i.columns, i.unique, i.predicate, i.constraint]),
      ).toEqual([
        ['products_name_lower', ['lower(name)'], false, null, null],
        ['products_pkey', ['id'], true, null, 'products_pkey'],
        ['products_sku_active', ['sku'], true, 'deleted_at IS NULL', null],
      ]);
      expect(products.indexes.every((i) => i.method === 'btree')).toBe(true);
    });

    it('reports row-level security flags', async () => {
      const db = await fresh(
        `create table documents (id int, organization_id int)`,
        `alter table documents enable row level security`,
        `create table notes (id int)`,
      );

      const snapshot = await introspect(db);

      expect(table(snapshot, 'public', 'documents').rowSecurity).toEqual({
        enabled: true,
        forced: false,
      });
      expect(table(snapshot, 'public', 'notes').rowSecurity).toEqual({
        enabled: false,
        forced: false,
      });
    });

    it('orders tables by code unit, independent of the database collation', async () => {
      const db = await fresh(
        `create schema b`,
        `create table b.beta (id int)`,
        `create table alpha (id int)`,
        `create table "Zeta" (id int)`,
        `create table _underscore (id int)`,
      );

      const names = (await introspect(db)).tables.map((t) => `${t.schema}.${t.name}`);

      expect(names).toEqual(['b.beta', 'public.Zeta', 'public._underscore', 'public.alpha']);
    });

    it('leaves out partitions and temporary tables', async () => {
      const db = await fresh(
        `create table measurements (id int, taken_on date) partition by range (taken_on)`,
        `create table measurements_2026 partition of measurements
           for values from ('2026-01-01') to ('2027-01-01')`,
        `create temporary table scratch (id int)`,
      );

      const names = (await introspect(db)).tables.map((t) => t.name);

      expect(names).toEqual(['measurements']);
    });

    it('diffs real changes, following renames through catalog identity', async () => {
      const db = await fresh();
      const empty = await introspect(db);

      await run(db, `create table users (id int primary key, name text)`);
      const created = await introspect(db);
      expect(types(diffSnapshots(empty, created))).toEqual(['table-created']);

      await run(
        db,
        `alter table users rename to customers`,
        `alter table customers rename column name to full_name`,
        `alter table customers add column phone text not null default ''`,
        `alter table customers rename constraint users_pkey to customers_pkey`,
        `create index customers_phone on customers (phone)`,
      );
      const renamed = await introspect(db);
      expect(diffSnapshots(created, renamed)).toMatchObject([
        { type: 'table-renamed', from: { name: 'users' }, to: { name: 'customers' } },
        { type: 'column-renamed', from: 'name', to: 'full_name' },
        { type: 'column-added', column: { name: 'phone', nullable: false } },
        { type: 'constraint-renamed', from: 'users_pkey', to: 'customers_pkey' },
        { type: 'index-created', index: { name: 'customers_phone' } },
      ]);

      await run(db, `drop table customers`, `create table customers (id int)`);
      const recreated = await introspect(db);
      expect(types(diffSnapshots(renamed, recreated))).toEqual(['table-dropped', 'table-created']);

      expect(diffSnapshots(recreated, await introspect(db))).toEqual([]);
    });

    it('sees uncommitted changes made earlier in the same session', async () => {
      const db = await fresh();

      await run(db, `begin`, `create table pending (id int)`);
      expect((await introspect(db)).tables.map((t) => t.name)).toEqual(['pending']);

      await run(db, `rollback`);
      expect((await introspect(db)).tables).toEqual([]);
    });
  });
}

async function run(db: SqlExecutor, ...statements: string[]): Promise<void> {
  for (const statement of statements) await db.query(statement);
}

function table(
  snapshot: { tables: readonly TableSnapshot[] },
  schema: string,
  name: string,
): TableSnapshot {
  const found = snapshot.tables.find((t) => t.schema === schema && t.name === name);
  if (!found) throw new Error(`table ${schema}.${name} not in snapshot`);
  return found;
}

const types = (changes: readonly { type: string }[]) => changes.map((c) => c.type);
