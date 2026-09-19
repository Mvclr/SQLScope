/**
 * Separate entry point (`@sqlscope/engine/display`): the UI needs these without loading
 * the SQL parser and its WebAssembly.
 *
 * Display metadata for the built-in PostgreSQL types that result columns carry as oids.
 * Oids of built-in types are fixed across every PostgreSQL installation.
 */

export type TypeCategory = 'number' | 'boolean' | 'json' | 'datetime' | 'binary' | 'array' | 'text';

interface BuiltinType {
  readonly name: string;
  readonly category: TypeCategory;
}

const builtins: Record<number, BuiltinType> = {
  16: { name: 'boolean', category: 'boolean' },
  17: { name: 'bytea', category: 'binary' },
  18: { name: 'char', category: 'text' },
  19: { name: 'name', category: 'text' },
  20: { name: 'bigint', category: 'number' },
  21: { name: 'smallint', category: 'number' },
  23: { name: 'integer', category: 'number' },
  25: { name: 'text', category: 'text' },
  26: { name: 'oid', category: 'number' },
  114: { name: 'json', category: 'json' },
  142: { name: 'xml', category: 'text' },
  700: { name: 'real', category: 'number' },
  701: { name: 'double precision', category: 'number' },
  790: { name: 'money', category: 'number' },
  1042: { name: 'character', category: 'text' },
  1043: { name: 'character varying', category: 'text' },
  1082: { name: 'date', category: 'datetime' },
  1083: { name: 'time', category: 'datetime' },
  1114: { name: 'timestamp', category: 'datetime' },
  1184: { name: 'timestamptz', category: 'datetime' },
  1186: { name: 'interval', category: 'datetime' },
  1266: { name: 'timetz', category: 'datetime' },
  1700: { name: 'numeric', category: 'number' },
  2950: { name: 'uuid', category: 'text' },
  3802: { name: 'jsonb', category: 'json' },
  // Arrays of the above.
  1000: { name: 'boolean[]', category: 'array' },
  1005: { name: 'smallint[]', category: 'array' },
  1007: { name: 'integer[]', category: 'array' },
  1009: { name: 'text[]', category: 'array' },
  1015: { name: 'character varying[]', category: 'array' },
  1016: { name: 'bigint[]', category: 'array' },
  1021: { name: 'real[]', category: 'array' },
  1022: { name: 'double precision[]', category: 'array' },
  1115: { name: 'timestamp[]', category: 'array' },
  1182: { name: 'date[]', category: 'array' },
  1185: { name: 'timestamptz[]', category: 'array' },
  1231: { name: 'numeric[]', category: 'array' },
  2951: { name: 'uuid[]', category: 'array' },
  3807: { name: 'jsonb[]', category: 'array' },
};

/** Name to show in a column header. User-defined types (enums, domains) show their oid. */
export const typeName = (oid: number): string => builtins[oid]?.name ?? `oid ${oid}`;

/** Drives alignment and formatting in the results grid. Unknown types render as text. */
export const typeCategory = (oid: number): TypeCategory => builtins[oid]?.category ?? 'text';
