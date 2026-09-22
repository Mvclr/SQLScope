'use client';

import type { DatabasePrivileges } from '@sqlscope/core';
import { Check, CircleX, KeyRound, LoaderCircle, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import { EmptyState } from '../ui/EmptyState';
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
    return (
      <p className="m-3 flex items-start gap-1.5 text-[12px] text-sev-critical">
        <CircleX aria-hidden className="mt-px size-3.5 shrink-0" />
        {privileges.error}
      </p>
    );
  }
  if (!privileges.data) {
    return (
      <p className="flex items-center gap-2 p-3 text-[12px] text-faint">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        Lendo privilégios…
      </p>
    );
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
      <p className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        Executando como
        <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-text">
          <UserRound aria-hidden className="size-3 text-faint" />
          {currentRole}
        </span>
        . A tabela é lida de <span className="font-mono">pg_class.relacl</span> a cada execução.
      </p>

      {tables.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong">
          <EmptyState icon={KeyRound}>
            Nenhum privilégio concedido explicitamente ainda. Só o dono alcança as tabelas.
          </EmptyState>
        </div>
      ) : (
        <div className="w-fit max-w-full overflow-x-auto rounded-xl border border-border">
          <table className="text-[12px]">
            <thead className="bg-surface-2">
              <tr className="text-faint">
                <th className="px-3 py-1.5 text-left font-normal">role</th>
                {tables.map((table) => (
                  <th
                    key={table}
                    colSpan={VERBS.length}
                    className="border-l border-border px-2 py-1.5 text-left font-mono font-medium text-text"
                  >
                    {table}
                  </th>
                ))}
              </tr>
              <tr className="text-faint">
                <th />
                {tables.flatMap((table) =>
                  VERBS.map((verb, i) => (
                    <th
                      key={`${table}-${verb}`}
                      className={`px-1.5 pb-1.5 font-mono text-[10px] font-normal ${i === 0 ? 'border-l border-border' : ''}`}
                    >
                      {verb.slice(0, 3).toLowerCase()}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {grantees.map((grantee) => (
                <tr key={grantee} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono text-text">{grantee}</td>
                  {tables.flatMap((table) =>
                    VERBS.map((verb, i) => (
                      <td
                        key={`${grantee}-${table}-${verb}`}
                        className={`px-1.5 py-1.5 text-center ${i === 0 ? 'border-l border-border' : ''}`}
                      >
                        {has(grantee, table, verb) ? (
                          <span
                            className="inline-grid size-5 place-items-center rounded-md bg-perf-gain/15 text-perf-gain"
                            title={`${verb} em ${table}`}
                          >
                            <Check aria-label={`${verb} em ${table}`} className="size-3" />
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
        </div>
      )}

      <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-faint">Roles</h3>
      <ul className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
        {roles
          .filter((role) => !isInfrastructure(role.name))
          .map((role) => (
            <li
              key={role.name}
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1"
            >
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
