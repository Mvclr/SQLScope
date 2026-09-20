import type { ForeignKeyConstraint, SchemaSnapshot, TableSnapshot } from '../snapshot.js';

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
    return `  "${column.name}" "${column.dataType}"${suffix}`;
  });

  const note = table.rowSecurity.enabled ? `  Note: 'row level security enabled'\n` : '';
  return `Table "${name(table)}" {\n${columns.join('\n')}\n${note}}`;
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
      return [`Ref: "${name(table)}"."${column}" > "${name(target)}"."${referenced}"`];
    });
}

const name = (table: TableSnapshot) =>
  table.schema === 'public' ? table.name : `${table.schema}.${table.name}`;
