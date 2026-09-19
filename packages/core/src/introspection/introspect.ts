import type { SqlExecutor } from '../executor.js';
import {
  compareText,
  type ColumnSnapshot,
  type ConstraintSnapshot,
  type IndexSnapshot,
  type ReferentialAction,
  type SchemaSnapshot,
  type TableSnapshot,
} from '../snapshot.js';
import {
  columnsQuery,
  constraintsQuery,
  indexesQuery,
  tablesQuery,
  type ColumnRow,
  type ConstraintRow,
  type IndexRow,
  type TableRow,
} from './queries.js';

/**
 * Reads the current structure of the database behind `db`.
 *
 * The database is the source of truth for the schema; SQLScope never infers structure
 * from the statements a user wrote (ADR 0003).
 */
export async function introspect(db: SqlExecutor): Promise<SchemaSnapshot> {
  // Sequential on purpose: an executor wraps a single session, which cannot run
  // statements concurrently.
  const tables = (await db.query<TableRow>(tablesQuery)).rows;
  const columns = (await db.query<ColumnRow>(columnsQuery)).rows;
  const constraints = (await db.query<ConstraintRow>(constraintsQuery)).rows;
  const indexes = (await db.query<IndexRow>(indexesQuery)).rows;

  const columnsByTable = groupBy(columns, (row) => row.table_id);
  const constraintsByTable = groupBy(constraints, (row) => row.table_id);
  const indexesByTable = groupBy(indexes, (row) => row.table_id);

  const snapshots = tables.map((table): TableSnapshot => ({
    id: table.id,
    schema: table.schema,
    name: table.name,
    columns: (columnsByTable.get(table.id) ?? [])
      .map(toColumn)
      .sort((a, b) => a.position - b.position),
    constraints: (constraintsByTable.get(table.id) ?? [])
      .map(toConstraint)
      .sort((a, b) => compareText(a.name, b.name)),
    indexes: (indexesByTable.get(table.id) ?? [])
      .map(toIndex)
      .sort((a, b) => compareText(a.name, b.name)),
    rowSecurity: { enabled: table.rls_enabled, forced: table.rls_forced },
  }));

  snapshots.sort((a, b) => compareText(a.schema, b.schema) || compareText(a.name, b.name));
  return { tables: snapshots };
}

function toColumn(row: ColumnRow): ColumnSnapshot {
  return {
    position: row.position,
    name: row.name,
    dataType: row.data_type,
    nullable: row.nullable,
    default: row.default_expression,
    identity: row.identity === 'a' ? 'always' : row.identity === 'd' ? 'by default' : null,
    generated:
      row.generated && row.generation_expression !== null
        ? {
            kind: row.generated === 's' ? 'stored' : 'virtual',
            expression: row.generation_expression,
          }
        : null,
  };
}

function toConstraint(row: ConstraintRow): ConstraintSnapshot {
  const base = { id: row.id, name: row.name, columns: row.columns, definition: row.definition };
  switch (row.type) {
    case 'p':
      return { ...base, kind: 'primary key' };
    case 'u':
      return { ...base, kind: 'unique' };
    case 'c':
      return { ...base, kind: 'check', expression: row.check_expression ?? '' };
    case 'f':
      return {
        ...base,
        kind: 'foreign key',
        references: {
          schema: row.ref_schema ?? '',
          name: row.ref_table ?? '',
          columns: row.ref_columns,
        },
        onUpdate: toReferentialAction(row.on_update),
        onDelete: toReferentialAction(row.on_delete),
      };
  }
}

const referentialActions: Record<string, ReferentialAction> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

function toReferentialAction(code: string): ReferentialAction {
  const action = referentialActions[code];
  if (!action) throw new Error(`Unknown referential action code: ${code}`);
  return action;
}

function toIndex(row: IndexRow): IndexSnapshot {
  return {
    id: row.id,
    name: row.name,
    columns: row.columns,
    unique: row.is_unique,
    method: row.method,
    predicate: row.predicate,
    definition: row.definition,
    constraint: row.constraint_name,
  };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
