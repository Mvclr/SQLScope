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
 * Says what the file holds, because what it leaves out matters: a reader who reimports
 * this and finds no views should know it was never there to begin with.
 */
const HEADER = `-- Export do SQLScope: tabelas, constraints e índices.
-- Não incluído: políticas RLS, views, sequences, tipos, funções e triggers.`;

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
 * Row-level security is reported, not reproduced.
 *
 * The policies live outside the snapshot (`readPrivileges`), so this export cannot carry
 * them — and `enable row level security` without its policies turns a table into one that
 * returns nothing to anybody but its owner. Losing the setting is bad; silently producing
 * an empty table is worse, so the export says what it saw and leaves the choice to whoever
 * reads it.
 */
function rowSecurity(table: TableSnapshot): string[] {
  if (!table.rowSecurity.enabled && !table.rowSecurity.forced) return [];
  const name = qualify(table.schema, table.name);
  const mode = table.rowSecurity.forced ? 'ativo e forçado' : 'ativo';
  return [
    `-- ${name}: row level security ${mode} no banco de origem.\n` +
      `-- As políticas não são exportadas; veja-as no relatório de segurança do SQLScope.`,
  ];
}
