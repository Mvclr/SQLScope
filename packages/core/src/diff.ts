import {
  compareText,
  type ColumnSnapshot,
  type ConstraintSnapshot,
  type IndexSnapshot,
  type PolicySnapshot,
  type RowSecurity,
  type SchemaSnapshot,
  type TableRef,
  type TableSnapshot,
} from './snapshot.js';

export type ColumnAttribute = 'dataType' | 'nullable' | 'default' | 'identity' | 'generated';

/**
 * One structural change between two snapshots. Table references always use the table's
 * name in the *newer* snapshot, except for changes to dropped tables.
 */
export type SchemaChange =
  | { readonly type: 'table-created'; readonly table: TableSnapshot }
  | { readonly type: 'table-dropped'; readonly table: TableSnapshot }
  | { readonly type: 'table-renamed'; readonly from: TableRef; readonly to: TableRef }
  | { readonly type: 'column-added'; readonly table: TableRef; readonly column: ColumnSnapshot }
  | { readonly type: 'column-dropped'; readonly table: TableRef; readonly column: ColumnSnapshot }
  | {
      readonly type: 'column-renamed';
      readonly table: TableRef;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly type: 'column-altered';
      readonly table: TableRef;
      readonly before: ColumnSnapshot;
      readonly after: ColumnSnapshot;
      readonly changed: readonly ColumnAttribute[];
    }
  | {
      readonly type: 'constraint-added';
      readonly table: TableRef;
      readonly constraint: ConstraintSnapshot;
    }
  | {
      readonly type: 'constraint-dropped';
      readonly table: TableRef;
      readonly constraint: ConstraintSnapshot;
    }
  | {
      readonly type: 'constraint-renamed';
      readonly table: TableRef;
      readonly from: string;
      readonly to: string;
    }
  | { readonly type: 'index-created'; readonly table: TableRef; readonly index: IndexSnapshot }
  | { readonly type: 'index-dropped'; readonly table: TableRef; readonly index: IndexSnapshot }
  | {
      readonly type: 'index-renamed';
      readonly table: TableRef;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly type: 'row-security-changed';
      readonly table: TableRef;
      readonly before: RowSecurity;
      readonly after: RowSecurity;
    }
  | { readonly type: 'policy-created'; readonly table: TableRef; readonly policy: PolicySnapshot }
  | { readonly type: 'policy-dropped'; readonly table: TableRef; readonly policy: PolicySnapshot }
  | {
      readonly type: 'policy-changed';
      readonly table: TableRef;
      readonly before: PolicySnapshot;
      readonly after: PolicySnapshot;
    };

/**
 * Computes the changes that turn `prev` into `next`.
 *
 * Objects are matched by catalog identity (oid for tables, constraints and indexes;
 * `attnum` for columns), not by name. That is what lets a rename be reported as a rename
 * instead of a drop followed by a create — and why both snapshots must come from the
 * same database.
 *
 * Indexes that implement a constraint are not reported separately; the constraint change
 * already describes them.
 *
 * Output order is stable and follows the order an animation should play in: drops first,
 * then changes to surviving tables, then new tables.
 */
export function diffSnapshots(prev: SchemaSnapshot, next: SchemaSnapshot): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const prevById = new Map(prev.tables.map((t) => [t.id, t]));
  const nextIds = new Set(next.tables.map((t) => t.id));

  for (const table of prev.tables) {
    if (!nextIds.has(table.id)) changes.push({ type: 'table-dropped', table });
  }

  for (const after of next.tables) {
    const before = prevById.get(after.id);
    if (before) changes.push(...diffTable(before, after));
  }

  for (const table of next.tables) {
    if (!prevById.has(table.id)) changes.push({ type: 'table-created', table });
  }

  return changes;
}

function diffTable(before: TableSnapshot, after: TableSnapshot): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const table: TableRef = { schema: after.schema, name: after.name };

  if (before.schema !== after.schema || before.name !== after.name) {
    changes.push({
      type: 'table-renamed',
      from: { schema: before.schema, name: before.name },
      to: table,
    });
  }

  const indexes = matchById(standalone(before.indexes), standalone(after.indexes));
  const constraints = matchById(before.constraints, after.constraints);
  const columns = matchBy(before.columns, after.columns, (c) => c.position);
  const policies = matchById(before.policies, after.policies);

  for (const index of indexes.removed) changes.push({ type: 'index-dropped', table, index });
  for (const constraint of constraints.removed) {
    changes.push({ type: 'constraint-dropped', table, constraint });
  }
  for (const column of columns.removed) changes.push({ type: 'column-dropped', table, column });
  for (const policy of policies.removed) changes.push({ type: 'policy-dropped', table, policy });

  for (const [b, a] of columns.kept) {
    if (b.name !== a.name)
      changes.push({ type: 'column-renamed', table, from: b.name, to: a.name });
  }
  for (const [b, a] of columns.kept) {
    const changed = alteredAttributes(b, a);
    if (changed.length > 0) {
      changes.push({ type: 'column-altered', table, before: b, after: a, changed });
    }
  }
  for (const column of columns.added) changes.push({ type: 'column-added', table, column });

  for (const [b, a] of constraints.kept) {
    if (b.name !== a.name) {
      changes.push({ type: 'constraint-renamed', table, from: b.name, to: a.name });
    }
  }
  for (const constraint of constraints.added) {
    changes.push({ type: 'constraint-added', table, constraint });
  }

  for (const [b, a] of indexes.kept) {
    if (b.name !== a.name) changes.push({ type: 'index-renamed', table, from: b.name, to: a.name });
  }
  for (const index of indexes.added) changes.push({ type: 'index-created', table, index });

  if (
    before.rowSecurity.enabled !== after.rowSecurity.enabled ||
    before.rowSecurity.forced !== after.rowSecurity.forced
  ) {
    changes.push({
      type: 'row-security-changed',
      table,
      before: before.rowSecurity,
      after: after.rowSecurity,
    });
  }

  // After the flag: turning row security on and writing the first policy is one thought,
  // and reads in that order.
  for (const [b, a] of policies.kept) {
    if (
      b.name !== a.name ||
      b.command !== a.command ||
      b.permissive !== a.permissive ||
      b.using !== a.using ||
      b.check !== a.check ||
      b.roles.join(',') !== a.roles.join(',')
    ) {
      changes.push({ type: 'policy-changed', table, before: b, after: a });
    }
  }
  for (const policy of policies.added) changes.push({ type: 'policy-created', table, policy });

  return changes;
}

function alteredAttributes(before: ColumnSnapshot, after: ColumnSnapshot): ColumnAttribute[] {
  const changed: ColumnAttribute[] = [];
  if (before.dataType !== after.dataType) changed.push('dataType');
  if (before.nullable !== after.nullable) changed.push('nullable');
  if (before.default !== after.default) changed.push('default');
  if (before.identity !== after.identity) changed.push('identity');
  if (
    before.generated?.kind !== after.generated?.kind ||
    before.generated?.expression !== after.generated?.expression
  ) {
    changed.push('generated');
  }
  return changed;
}

const standalone = (indexes: readonly IndexSnapshot[]) => indexes.filter((i) => !i.constraint);

const matchById = <T extends { id: string; name: string }>(
  before: readonly T[],
  after: readonly T[],
) => {
  const matched = matchBy(before, after, (item) => item.id);
  const byName = (a: T, b: T) => compareText(a.name, b.name);
  return {
    removed: matched.removed.sort(byName),
    kept: matched.kept,
    added: matched.added.sort(byName),
  };
};

function matchBy<T, K>(before: readonly T[], after: readonly T[], key: (item: T) => K) {
  const afterByKey = new Map(after.map((item) => [key(item), item]));
  const beforeKeys = new Set(before.map(key));
  const removed: T[] = [];
  const kept: [T, T][] = [];
  for (const item of before) {
    const counterpart = afterByKey.get(key(item));
    if (counterpart === undefined) removed.push(item);
    else kept.push([item, counterpart]);
  }
  const added = after.filter((item) => !beforeKeys.has(key(item)));
  return { removed, kept, added };
}
