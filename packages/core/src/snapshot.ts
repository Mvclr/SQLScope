/**
 * Immutable description of a database's user-defined structure at one point in time.
 * Produced by `introspect` and compared by `diffSnapshots` (ADR 0003).
 *
 * Every collection is sorted by code-unit order (never by collation) so that two engines
 * holding the same schema produce identical snapshots.
 */
export interface SchemaSnapshot {
  readonly tables: readonly TableSnapshot[];
}

export interface TableRef {
  readonly schema: string;
  readonly name: string;
}

export interface TableSnapshot extends TableRef {
  /** `pg_class` oid. Survives renames, changes on drop/recreate. Only meaningful within one database. */
  readonly id: string;
  readonly columns: readonly ColumnSnapshot[];
  readonly constraints: readonly ConstraintSnapshot[];
  readonly indexes: readonly IndexSnapshot[];
  readonly rowSecurity: RowSecurity;
  readonly policies: readonly PolicySnapshot[];
}

export interface ColumnSnapshot {
  /** `attnum`. Survives renames; gaps appear where columns were dropped. */
  readonly position: number;
  readonly name: string;
  /** As rendered by `format_type`, e.g. `character varying(255)`. */
  readonly dataType: string;
  readonly nullable: boolean;
  readonly default: string | null;
  readonly identity: 'always' | 'by default' | null;
  readonly generated: GeneratedColumn | null;
}

export interface GeneratedColumn {
  readonly kind: 'stored' | 'virtual';
  readonly expression: string;
}

export type ReferentialAction = 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';

interface ConstraintBase {
  /** `pg_constraint` oid. Survives renames; any change to the definition means a new constraint. */
  readonly id: string;
  readonly name: string;
  readonly columns: readonly string[];
  /** As rendered by `pg_get_constraintdef`. */
  readonly definition: string;
}

export interface PrimaryKeyConstraint extends ConstraintBase {
  readonly kind: 'primary key';
}

export interface UniqueConstraint extends ConstraintBase {
  readonly kind: 'unique';
}

export interface ForeignKeyConstraint extends ConstraintBase {
  readonly kind: 'foreign key';
  readonly references: TableRef & { readonly columns: readonly string[] };
  readonly onUpdate: ReferentialAction;
  readonly onDelete: ReferentialAction;
}

export interface CheckConstraint extends ConstraintBase {
  readonly kind: 'check';
  readonly expression: string;
}

export type ConstraintSnapshot =
  PrimaryKeyConstraint | UniqueConstraint | ForeignKeyConstraint | CheckConstraint;

export interface IndexSnapshot {
  /** Index relation oid. Survives renames. */
  readonly id: string;
  readonly name: string;
  /** Key columns or expressions, in key order. */
  readonly columns: readonly string[];
  readonly unique: boolean;
  /** Access method: `btree`, `hash`, `gin`, ... */
  readonly method: string;
  readonly predicate: string | null;
  readonly definition: string;
  /** Name of the primary key / unique constraint this index implements, if any. */
  readonly constraint: string | null;
}

export interface RowSecurity {
  readonly enabled: boolean;
  readonly forced: boolean;
}

export type PolicyCommand = 'all' | 'select' | 'insert' | 'update' | 'delete';

/**
 * A row-level policy: which rows a role may read (`using`) and which it may write
 * (`check`). Part of the schema, and the part that decides what a table answers.
 */
export interface PolicySnapshot {
  /** `pg_policy` oid. Survives renames. */
  readonly id: string;
  readonly name: string;
  readonly command: PolicyCommand;
  /** `false` for a RESTRICTIVE policy, which narrows instead of widening. */
  readonly permissive: boolean;
  /** `PUBLIC` when the policy names no role, meaning every role. */
  readonly roles: readonly string[];
  /** Expression deciding which existing rows are visible; `null` for none. */
  readonly using: string | null;
  /** Expression every written row must satisfy; `null` for none. */
  readonly check: string | null;
}

export const qualifiedName = (table: TableRef): string => `${table.schema}.${table.name}`;

/** Code-unit comparison: deterministic and identical on every engine, unlike collations. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
