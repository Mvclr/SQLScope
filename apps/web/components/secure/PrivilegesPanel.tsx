'use client';

import type { DatabasePrivileges } from '@sqlscope/core';
import { useEffect } from 'react';
import { useWorkspace } from '../workspace/context';

const VERBS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;

/** Roles the cluster brings with it; the lab is about the ones the learner creates. */
const isInfrastructure = (role: string) => role.startsWith('pg_') || role === 'postgres';

/**
 * Who may do what, read from the catalog after every run.
 *
 * A grant is invisible in the SQL that follows it — the point of the matrix is that the
 * learner sees the permission change at the moment they change it, instead of inferring
 * it from an error three statements later.
 */
export function PrivilegesPanel() {
  const privileges = useWorkspace((s) => s.privileges);
  const read = useWorkspace((s) => s.readPrivileges);
  const runs = useWorkspace((s) => s.runs.length);
  const status = useWorkspace((s) => s.status);

  // Grants leave no trace in the schema, so the matrix follows runs, not snapshots.
  useEffect(() => {
    if (status === 'ready') void read();
  }, [read, runs, status]);

  if (privileges.error !== null) {
    return <p className="p-3 text-[12px] text-sev-danger">{privileges.error}</p>;
  }
  if (!privileges.data) {
    return <p className="p-3 text-[12px] text-faint">Lendo privilégios…</p>;
  }

  return <Matrix privileges={privileges.data} />;
}

function Matrix({ privileges }: { privileges: DatabasePrivileges }) {
  const { tableGrants, roles, currentRole } = privileges;
  const tables = [...new Set(tableGrants.map((grant) => grant.name))].sort();
  const grantees = [
    ...new Set([
      ...roles.filter((role) => !isInfrastructure(role.name)).map((role) => role.name),
      ...tableGrants.map((grant) => grant.grantee),
    ]),
  ].sort();

  const has = (grantee: string, table: string, verb: string) =>
    tableGrants.some((g) => g.grantee === grantee && g.name === table && g.privilege === verb);

  return (
    <div className="h-full overflow-auto p-3">
      <p className="mb-3 text-[12px] text-muted">
        Executando como <span className="font-mono text-text">{currentRole}</span>. A tabela é lida
        de <span className="font-mono">pg_class.relacl</span> a cada execução.
      </p>

      {tables.length === 0 ? (
        <p className="text-[12px] text-faint">
          Nenhum privilégio concedido explicitamente ainda. Só o dono alcança as tabelas.
        </p>
      ) : (
        <table className="text-[12px]">
          <thead>
            <tr className="text-faint">
              <th className="px-2 py-1 text-left font-normal">role</th>
              {tables.map((table) => (
                <th key={table} colSpan={VERBS.length} className="px-2 py-1 text-left font-mono">
                  {table}
                </th>
              ))}
            </tr>
            <tr className="text-faint">
              <th />
              {tables.flatMap((table) =>
                VERBS.map((verb) => (
                  <th key={`${table}-${verb}`} className="px-1 py-1 font-normal">
                    {verb.slice(0, 3).toLowerCase()}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {grantees.map((grantee) => (
              <tr key={grantee} className="border-t border-border/60">
                <td className="px-2 py-1 font-mono text-text">{grantee}</td>
                {tables.flatMap((table) =>
                  VERBS.map((verb) => (
                    <td key={`${grantee}-${table}-${verb}`} className="px-1 py-1 text-center">
                      {has(grantee, table, verb) ? (
                        <span className="text-perf-gain" title={`${verb} em ${table}`}>
                          ●
                        </span>
                      ) : (
                        <span className="text-faint">·</span>
                      )}
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="mt-5 text-[11px] uppercase tracking-wide text-faint">Roles</h3>
      <ul className="mt-2 space-y-1 text-[12px]">
        {roles
          .filter((role) => !isInfrastructure(role.name))
          .map((role) => (
            <li key={role.name}>
              <span className="font-mono text-text">{role.name}</span>
              <span className="ml-2 text-muted">
                {role.canLogin ? 'login' : 'nologin'}
                {role.superuser && ' · superuser'}
                {role.bypassRls && ' · bypassrls'}
                {role.memberOf.length > 0 && ` · membro de ${role.memberOf.join(', ')}`}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
