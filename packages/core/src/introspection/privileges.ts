import type { SqlExecutor } from '../executor.js';
import { compareText } from '../snapshot.js';

/**
 * Who may do what in a database. Read separately from `SchemaSnapshot`: the schema
 * changes with almost every statement, privileges rarely.
 */
export interface DatabasePrivileges {
  readonly currentRole: string;
  readonly roles: readonly RoleSummary[];
  /** Explicit grants only; a table with no `relacl` is reachable by its owner alone. */
  readonly tableGrants: readonly Grant[];
  readonly schemaGrants: readonly Grant[];
}

export interface RoleSummary {
  readonly name: string;
  readonly superuser: boolean;
  readonly createRole: boolean;
  readonly createDb: boolean;
  readonly canLogin: boolean;
  readonly bypassRls: boolean;
  readonly memberOf: readonly string[];
}

export interface Grant {
  readonly schema: string;
  /** Empty for a schema grant. */
  readonly name: string;
  readonly owner: string;
  /** `PUBLIC` means everyone, including future roles. */
  readonly grantee: string;
  /** `SELECT`, `INSERT`, `CREATE`, ... as PostgreSQL names them. */
  readonly privilege: string;
}

const userSchemas = `n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'`;

interface RoleRow extends Record<string, unknown> {
  name: string;
  superuser: boolean;
  create_role: boolean;
  create_db: boolean;
  can_login: boolean;
  bypass_rls: boolean;
  member_of: string[];
}

interface GrantRow extends Record<string, unknown> {
  schema: string;
  name: string;
  owner: string;
  grantee: string;
  privilege: string;
}

/**
 * Reads who may do what in the current database.
 *
 * Row-level policies are not here: they belong to the tables they protect, and
 * `introspect` reads them into the snapshot.
 */
export async function readPrivileges(db: SqlExecutor): Promise<DatabasePrivileges> {
  const current = await db.query<{ role: string }>('select current_user as role');

  // System roles (pg_read_all_data and friends) are noise: they exist everywhere.
  const roles = await db.query<RoleRow>(`
    select r.rolname as name,
           r.rolsuper as superuser,
           r.rolcreaterole as create_role,
           r.rolcreatedb as create_db,
           r.rolcanlogin as can_login,
           r.rolbypassrls as bypass_rls,
           array(
             select m.rolname from pg_catalog.pg_auth_members am
             join pg_catalog.pg_roles m on m.oid = am.roleid
             where am.member = r.oid
           )::text[] as member_of
    from pg_catalog.pg_roles r
    where r.rolname not like 'pg\\_%'`);

  const tableGrants = await db.query<GrantRow>(`
    select n.nspname as schema,
           c.relname as name,
           o.rolname as owner,
           coalesce(g.rolname, 'PUBLIC') as grantee,
           a.privilege_type as privilege
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_roles o on o.oid = c.relowner
    cross join lateral aclexplode(c.relacl) a
    left join pg_catalog.pg_roles g on g.oid = a.grantee
    where c.relkind in ('r', 'p', 'v', 'm') and c.relacl is not null and ${userSchemas}`);

  const schemaGrants = await db.query<GrantRow>(`
    select n.nspname as schema,
           '' as name,
           o.rolname as owner,
           coalesce(g.rolname, 'PUBLIC') as grantee,
           a.privilege_type as privilege
    from pg_catalog.pg_namespace n
    join pg_catalog.pg_roles o on o.oid = n.nspowner
    cross join lateral aclexplode(n.nspacl) a
    left join pg_catalog.pg_roles g on g.oid = a.grantee
    where n.nspacl is not null and ${userSchemas}`);

  return {
    currentRole: current.rows[0]?.role ?? '',
    roles: roles.rows
      .map((row): RoleSummary => ({
        name: row.name,
        superuser: row.superuser,
        createRole: row.create_role,
        createDb: row.create_db,
        canLogin: row.can_login,
        bypassRls: row.bypass_rls,
        memberOf: [...row.member_of].sort(compareText),
      }))
      .sort((a, b) => compareText(a.name, b.name)),
    tableGrants: toGrants(tableGrants.rows),
    schemaGrants: toGrants(schemaGrants.rows),
  };
}

const toGrants = (rows: readonly GrantRow[]): Grant[] =>
  rows
    .map((row): Grant => ({
      schema: row.schema,
      name: row.name,
      owner: row.owner,
      grantee: row.grantee,
      privilege: row.privilege,
    }))
    .sort(
      (a, b) =>
        compareText(a.schema, b.schema) ||
        compareText(a.name, b.name) ||
        compareText(a.grantee, b.grantee) ||
        compareText(a.privilege, b.privilege),
    );
