/**
 * Catalog queries behind `introspect`. They read `pg_catalog` directly rather than
 * `information_schema` because the latter hides objects the current role does not own
 * and does not expose oids, which the diff relies on to follow renames.
 *
 * Ordering is deliberately left to the caller: `ORDER BY` on names would follow the
 * database collation, which differs between PGlite and a server cluster.
 */

/** Ordinary and partitioned tables in user schemas. Partitions are represented by their parent. */
const userTables = `
  user_tables as (
    select c.oid
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and not c.relispartition
      and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg\\_toast%'
      and n.nspname not like 'pg\\_temp%'
  )`;

export interface TableRow extends Record<string, unknown> {
  id: string;
  schema: string;
  name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
}

export const tablesQuery = `
  with ${userTables}
  select c.oid::text as id,
         n.nspname as schema,
         c.relname as name,
         c.relrowsecurity as rls_enabled,
         c.relforcerowsecurity as rls_forced
  from user_tables t
  join pg_catalog.pg_class c on c.oid = t.oid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace`;

export interface ColumnRow extends Record<string, unknown> {
  table_id: string;
  position: number;
  name: string;
  data_type: string;
  nullable: boolean;
  default_expression: string | null;
  identity: 'a' | 'd' | null;
  generated: 's' | 'v' | null;
  generation_expression: string | null;
}

export const columnsQuery = `
  with ${userTables}
  select a.attrelid::text as table_id,
         a.attnum as position,
         a.attname as name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
         not a.attnotnull as nullable,
         case when a.attgenerated = '' then pg_catalog.pg_get_expr(d.adbin, d.adrelid) end
           as default_expression,
         nullif(a.attidentity, '')::text as identity,
         nullif(a.attgenerated, '')::text as generated,
         case when a.attgenerated <> '' then pg_catalog.pg_get_expr(d.adbin, d.adrelid) end
           as generation_expression
  from user_tables t
  join pg_catalog.pg_attribute a on a.attrelid = t.oid
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0
    and not a.attisdropped`;

export interface ConstraintRow extends Record<string, unknown> {
  id: string;
  table_id: string;
  name: string;
  type: 'p' | 'u' | 'f' | 'c';
  columns: string[];
  ref_schema: string | null;
  ref_table: string | null;
  ref_columns: string[];
  on_update: string;
  on_delete: string;
  check_expression: string | null;
  definition: string;
}

/**
 * NOT NULL constraints (`contype = 'n'`, catalogued since PostgreSQL 18) are left out:
 * they are already represented by `ColumnSnapshot.nullable`.
 */
export const constraintsQuery = `
  with ${userTables}
  select c.oid::text as id,
         c.conrelid::text as table_id,
         c.conname as name,
         c.contype::text as type,
         array(
           select a.attname
           from unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
           order by k.ord
         )::text[] as columns,
         fn.nspname as ref_schema,
         fc.relname as ref_table,
         array(
           select a.attname
           from unnest(c.confkey) with ordinality as k(attnum, ord)
           join pg_catalog.pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
           order by k.ord
         )::text[] as ref_columns,
         c.confupdtype::text as on_update,
         c.confdeltype::text as on_delete,
         case when c.contype = 'c' then pg_catalog.pg_get_expr(c.conbin, c.conrelid, true) end
           as check_expression,
         pg_catalog.pg_get_constraintdef(c.oid, true) as definition
  from user_tables t
  join pg_catalog.pg_constraint c on c.conrelid = t.oid
  left join pg_catalog.pg_class fc on fc.oid = c.confrelid
  left join pg_catalog.pg_namespace fn on fn.oid = fc.relnamespace
  where c.contype in ('p', 'u', 'f', 'c')`;

export interface IndexRow extends Record<string, unknown> {
  id: string;
  table_id: string;
  name: string;
  is_unique: boolean;
  method: string;
  columns: string[];
  predicate: string | null;
  definition: string;
  constraint_name: string | null;
}

/**
 * `conindid` is also set on foreign keys (pointing at the referenced table's index),
 * so the constraint join is restricted to constraints owned by the indexed table.
 */
export const indexesQuery = `
  with ${userTables}
  select i.indexrelid::text as id,
         i.indrelid::text as table_id,
         ic.relname as name,
         i.indisunique as is_unique,
         am.amname as method,
         array(
           select pg_catalog.pg_get_indexdef(i.indexrelid, k, true)
           from generate_series(1, i.indnkeyatts) as k
           order by k
         )::text[] as columns,
         pg_catalog.pg_get_expr(i.indpred, i.indrelid, true) as predicate,
         pg_catalog.pg_get_indexdef(i.indexrelid) as definition,
         con.conname as constraint_name
  from user_tables t
  join pg_catalog.pg_index i on i.indrelid = t.oid
  join pg_catalog.pg_class ic on ic.oid = i.indexrelid
  join pg_catalog.pg_am am on am.oid = ic.relam
  left join pg_catalog.pg_constraint con
    on con.conindid = i.indexrelid
   and con.conrelid = i.indrelid
   and con.contype in ('p', 'u', 'x')`;
