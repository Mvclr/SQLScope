import { describe, expect, it } from 'vitest';
import {
  diffSnapshots,
  type ColumnSnapshot,
  type IndexSnapshot,
  type TableSnapshot,
} from '../src/index.js';

const column = (position: number, name: string, over: Partial<ColumnSnapshot> = {}) =>
  ({
    position,
    name,
    dataType: 'integer',
    nullable: true,
    default: null,
    identity: null,
    generated: null,
    ...over,
  }) satisfies ColumnSnapshot;

const index = (id: string, name: string, over: Partial<IndexSnapshot> = {}) =>
  ({
    id,
    name,
    columns: ['id'],
    unique: false,
    method: 'btree',
    predicate: null,
    definition: `CREATE INDEX ${name} ON t USING btree (id)`,
    constraint: null,
    ...over,
  }) satisfies IndexSnapshot;

const table = (id: string, name: string, over: Partial<TableSnapshot> = {}): TableSnapshot => ({
  id,
  schema: 'public',
  name,
  columns: [column(1, 'id')],
  constraints: [],
  indexes: [],
  rowSecurity: { enabled: false, forced: false },
  ...over,
});

const snapshot = (...tables: TableSnapshot[]) => ({ tables });

describe('diffSnapshots', () => {
  it('reports nothing for identical snapshots', () => {
    const s = snapshot(table('1', 'users'), table('2', 'orders'));
    expect(diffSnapshots(s, s)).toEqual([]);
  });

  it('treats a new oid under an old name as drop and create', () => {
    const changes = diffSnapshots(snapshot(table('1', 'users')), snapshot(table('9', 'users')));
    expect(changes.map((c) => c.type)).toEqual(['table-dropped', 'table-created']);
  });

  it('lists every altered column attribute', () => {
    const before = table('1', 'users', {
      columns: [column(1, 'id'), column(2, 'email', { dataType: 'text' })],
    });
    const after = table('1', 'users', {
      columns: [
        column(1, 'id'),
        column(2, 'email', { dataType: 'character varying(255)', nullable: false, default: "''" }),
      ],
    });

    expect(diffSnapshots(snapshot(before), snapshot(after))).toEqual([
      {
        type: 'column-altered',
        table: { schema: 'public', name: 'users' },
        before: before.columns[1],
        after: after.columns[1],
        changed: ['dataType', 'nullable', 'default'],
      },
    ]);
  });

  it('reports a column renamed and altered at once as two changes', () => {
    const before = table('1', 't', { columns: [column(1, 'a')] });
    const after = table('1', 't', { columns: [column(1, 'b', { dataType: 'bigint' })] });

    expect(diffSnapshots(snapshot(before), snapshot(after)).map((c) => c.type)).toEqual([
      'column-renamed',
      'column-altered',
    ]);
  });

  it('matches columns by position, so drop and re-add of a name is two changes', () => {
    const before = table('1', 't', { columns: [column(1, 'id'), column(2, 'x')] });
    const after = table('1', 't', { columns: [column(1, 'id'), column(3, 'x')] });

    expect(diffSnapshots(snapshot(before), snapshot(after)).map((c) => c.type)).toEqual([
      'column-dropped',
      'column-added',
    ]);
  });

  it('ignores indexes that implement constraints', () => {
    const before = table('1', 't');
    const after = table('1', 't', {
      indexes: [index('50', 't_pkey', { unique: true, constraint: 't_pkey' })],
    });

    expect(diffSnapshots(snapshot(before), snapshot(after))).toEqual([]);
  });

  it('reports index creation, drop and rename', () => {
    const before = table('1', 't', { indexes: [index('10', 'a'), index('11', 'b')] });
    const after = table('1', 't', { indexes: [index('11', 'b2'), index('12', 'c')] });

    expect(diffSnapshots(snapshot(before), snapshot(after))).toMatchObject([
      { type: 'index-dropped', index: { name: 'a' } },
      { type: 'index-renamed', from: 'b', to: 'b2' },
      { type: 'index-created', index: { name: 'c' } },
    ]);
  });

  it('reports row-level security changes', () => {
    const after = table('1', 't', { rowSecurity: { enabled: true, forced: true } });

    expect(diffSnapshots(snapshot(table('1', 't')), snapshot(after))).toEqual([
      {
        type: 'row-security-changed',
        table: { schema: 'public', name: 't' },
        before: { enabled: false, forced: false },
        after: { enabled: true, forced: true },
      },
    ]);
  });

  it('refers to the new table name in changes that accompany a rename', () => {
    const before = table('1', 'users');
    const after = table('1', 'customers', { columns: [column(1, 'id'), column(2, 'phone')] });

    expect(diffSnapshots(snapshot(before), snapshot(after))).toMatchObject([
      { type: 'table-renamed', from: { name: 'users' }, to: { name: 'customers' } },
      { type: 'column-added', table: { name: 'customers' } },
    ]);
  });

  it('orders drops before changes before creations', () => {
    const before = snapshot(table('1', 'kept'), table('2', 'gone'));
    const after = snapshot(
      table('3', 'born'),
      table('1', 'kept', { columns: [column(1, 'id'), column(2, 'extra')] }),
    );

    expect(diffSnapshots(before, after).map((c) => c.type)).toEqual([
      'table-dropped',
      'column-added',
      'table-created',
    ]);
  });
});
