import type { ColumnSnapshot, SchemaSnapshot, TableSnapshot } from '../snapshot.js';
import { compareText } from '../snapshot.js';

/** Quotes an identifier only when PostgreSQL would need it. */
export function quoteIdentifier(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) && !RESERVED.has(name)
    ? name
    : `"${name.replaceAll('"', '""')}"`;
}

const RESERVED = new Set([
  'all',
  'analyse',
  'analyze',
  'and',
  'any',
  'array',
  'as',
  'asc',
  'authorization',
  'binary',
  'both',
  'case',
  'cast',
  'check',
  'collate',
  'column',
  'constraint',
  'create',
  'cross',
  'current_date',
  'current_role',
  'current_time',
  'current_timestamp',
  'current_user',
  'default',
  'deferrable',
  'desc',
  'distinct',
  'do',
  'else',
  'end',
  'except',
  'false',
  'for',
  'foreign',
  'from',
  'full',
  'grant',
  'group',
  'having',
  'in',
  'initially',
  'inner',
  'intersect',
  'into',
  'is',
  'join',
  'lateral',
  'leading',
  'left',
  'like',
  'limit',
  'localtime',
  'localtimestamp',
  'natural',
  'not',
  'null',
  'offset',
  'on',
  'only',
  'or',
  'order',
  'outer',
  'overlaps',
  'placing',
  'primary',
  'references',
  'returning',
  'right',
  'select',
  'session_user',
  'similar',
  'some',
  'symmetric',
  'table',
  'then',
  'to',
  'trailing',
  'true',
  'union',
  'unique',
  'user',
  'using',
  'variadic',
  'verbose',
  'when',
  'where',
  'window',
  'with',
]);

const qualify = (schema: string, name: string) =>
  schema === 'public'
    ? quoteIdentifier(name)
    : `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;

/**
 * Rebuilds the SQL that creates a schema.
 *
 * Tables come first, then constraints, then indexes: foreign keys may point in any
 * direction, so nothing is ordered by dependency — every reference already exists by the
 * time constraints are added.
 */
export function toDdl(snapshot: SchemaSnapshot): string {
  const schemas = [...new Set(snapshot.tables.map((t) => t.schema))]
    .filter((schema) => schema !== 'public')
    .sort(compareText);

  const parts = [
    ...schemas.map((schema) => `create schema ${quoteIdentifier(schema)};`),
    ...snapshot.tables.map(createTable),
    // Keys and checks first: a foreign key needs the unique constraint it points at to
    // exist already, and tables are ordered by name, not by dependency.
    ...snapshot.tables.flatMap((table) => addConstraints(table, false)),
    ...snapshot.tables.flatMap((table) => addConstraints(table, true)),
    ...snapshot.tables.flatMap(createIndexes),
    ...snapshot.tables.flatMap(rowSecurity),
  ];
  return parts.join('\n\n') + '\n';
}

function createTable(table: TableSnapshot): string {
  const columns = table.columns.map((column) => `  ${columnDefinition(column)}`);
  return `create table ${qualify(table.schema, table.name)} (\n${columns.join(',\n')}\n);`;
}

function columnDefinition(column: ColumnSnapshot): string {
  const parts = [quoteIdentifier(column.name), column.dataType];
  if (column.generated) parts.push(`generated always as (${column.generated.expression}) stored`);
  else if (column.identity) parts.push(`generated ${column.identity} as identity`);
  else if (column.default !== null) parts.push(`default ${column.default}`);
  if (!column.nullable) parts.push('not null');
  return parts.join(' ');
}

/** `pg_get_constraintdef` already prints exactly what `ADD CONSTRAINT` expects. */
function addConstraints(table: TableSnapshot, foreignKeys: boolean): string[] {
  return table.constraints
    .filter((constraint) => (constraint.kind === 'foreign key') === foreignKeys)
    .map(
      (constraint) =>
        `alter table ${qualify(table.schema, table.name)}\n  add constraint ${quoteIdentifier(constraint.name)} ${constraint.definition};`,
    );
}

/** Indexes that implement a constraint were already created with it. */
function createIndexes(table: TableSnapshot): string[] {
  return table.indexes.filter((index) => !index.constraint).map((index) => `${index.definition};`);
}

function rowSecurity(table: TableSnapshot): string[] {
  const statements: string[] = [];
  const name = qualify(table.schema, table.name);
  if (table.rowSecurity.enabled) statements.push(`alter table ${name} enable row level security;`);
  if (table.rowSecurity.forced) statements.push(`alter table ${name} force row level security;`);
  return statements;
}
