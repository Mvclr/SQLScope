import type { ForeignKeyConstraint, SchemaSnapshot, TableSnapshot } from '../snapshot.js';

/**
 * Wraps a name in the double quotes DBML uses, escaping any the name itself contains so a
 * table or column named `a"b` cannot break out of its quotes and corrupt the file. DBML
 * strings take backslash escapes, the same as its `Note` strings.
 */
const quote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/**
 * Renders the schema as DBML (dbdiagram.io), the format most diagram tools import.
 *
 * Only what a diagram shows: tables, columns, keys and relationships.
 */
export function toDbml(snapshot: SchemaSnapshot): string {
  const blocks = snapshot.tables.map((table) => tableBlock(table));
  const references = snapshot.tables.flatMap((table) => referenceLines(table, snapshot));
  return [...blocks, ...references].join('\n\n') + '\n';
}

function tableBlock(table: TableSnapshot): string {
  const primaryKey = table.constraints.find((c) => c.kind === 'primary key');
  const unique = new Set(
    table.constraints
      .filter((c) => c.kind === 'unique' && c.columns.length === 1)
      .map((c) => c.columns[0]),
  );

  const columns = table.columns.map((column) => {
    const settings = [
      primaryKey?.columns.length === 1 && primaryKey.columns[0] === column.name ? 'pk' : null,
      primaryKey && primaryKey.columns.length > 1 && primaryKey.columns.includes(column.name)
        ? 'pk'
        : null,
      unique.has(column.name) ? 'unique' : null,
      !column.nullable ? 'not null' : null,
      column.identity ? 'increment' : null,
    ].filter(Boolean);
    const suffix = settings.length > 0 ? ` [${settings.join(', ')}]` : '';
    return `  ${quote(column.name)} ${quote(column.dataType)}${suffix}`;
  });

  const note = table.rowSecurity.enabled ? `  Note: 'row level security enabled'\n` : '';
  return `Table ${quote(name(table))} {\n${columns.join('\n')}\n${note}}`;
}

/** `>` is "many to one" in DBML: many rows here point at one row there. */
function referenceLines(table: TableSnapshot, snapshot: SchemaSnapshot): string[] {
  return table.constraints
    .filter((c): c is ForeignKeyConstraint => c.kind === 'foreign key')
    .flatMap((constraint) => {
      const target = snapshot.tables.find(
        (t) => t.schema === constraint.references.schema && t.name === constraint.references.name,
      );
      const [column] = constraint.columns;
      const [referenced] = constraint.references.columns;
      if (!target || !column || !referenced) return [];
      return [
        `Ref: ${quote(name(table))}.${quote(column)} > ${quote(name(target))}.${quote(referenced)}`,
      ];
    });
}

const name = (table: TableSnapshot) =>
  table.schema === 'public' ? table.name : `${table.schema}.${table.name}`;
