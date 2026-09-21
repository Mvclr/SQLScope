import type { ColumnSnapshot, PolicySnapshot, SchemaSnapshot, TableSnapshot } from '../snapshot.js';
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
 * Says what the file holds, because what it leaves out matters: a reader who reimports
 * this and finds no views should know it was never there to begin with.
 */
const HEADER = `-- Export do SQLScope: tabelas, constraints, índices e políticas RLS.
-- Não incluído: views, sequences, tipos, funções e triggers.`;

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
    HEADER,
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

/**
 * Row-level security: the flags and then the policies that make them usable.
 *
 * Both or neither. Enabling row security without its policies produces a table that
 * answers nothing to anybody but its owner, which would be a quiet way of exporting a
 * different database from the one that was read.
 */
function rowSecurity(table: TableSnapshot): string[] {
  const name = qualify(table.schema, table.name);
  const statements: string[] = [];
  if (table.rowSecurity.enabled) statements.push(`alter table ${name} enable row level security;`);
  if (table.rowSecurity.forced) statements.push(`alter table ${name} force row level security;`);
  return [...statements, ...table.policies.map((policy) => createPolicy(name, policy))];
}

function createPolicy(table: string, policy: PolicySnapshot): string {
  const parts = [`create policy ${quoteIdentifier(policy.name)} on ${table}`];
  if (!policy.permissive) parts.push('  as restrictive');
  if (policy.command !== 'all') parts.push(`  for ${policy.command}`);
  // `public` is the default, and naming it would still be true — but PostgreSQL prints
  // policies without it, and a diff of two exports should not show noise.
  if (policy.roles.join(',') !== 'public') {
    parts.push(`  to ${policy.roles.map(quoteIdentifier).join(', ')}`);
  }
  if (policy.using !== null) parts.push(`  using (${policy.using})`);
  if (policy.check !== null) parts.push(`  with check (${policy.check})`);
  return `${parts.join('\n')};`;
}
