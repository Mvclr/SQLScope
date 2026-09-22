'use client';

import type { TableSnapshot } from '@sqlscope/core';
import { Rows3, Table2, TriangleAlert } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { useWorkspace } from '../workspace/context';

/**
 * Row-level security as the catalog holds it: the flags, and the policies under them.
 *
 * Policies travel in the schema snapshot, so this panel needs no request of its own — it
 * redraws with the diagram, on the same run that changed them.
 */
export function PoliciesPanel() {
  const snapshot = useWorkspace((s) => s.snapshot);
  const guarded = snapshot.tables.filter(
    (table) => table.rowSecurity.enabled || table.policies.length > 0,
  );

  if (snapshot.tables.length === 0) {
    return <EmptyState icon={Table2}>Nenhuma tabela ainda.</EmptyState>;
  }

  return (
    <div className="h-full overflow-auto p-3">
      {guarded.length === 0 ? (
        <EmptyState icon={Rows3}>
          Nenhuma tabela com row level security. Toda linha é visível para quem alcança a tabela.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {guarded.map((table) => (
            <li key={table.id}>
              <Table table={table} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Table({ table }: { table: TableSnapshot }) {
  const { rowSecurity, policies } = table;

  return (
    <section className="rounded-xl border border-border p-3">
      <header className="flex flex-wrap items-center gap-2">
        <Table2 aria-hidden className="size-3.5 text-structure" />
        <span className="font-mono text-[13px] font-medium text-text">{table.name}</span>
        <Flag on={rowSecurity.enabled} label="row level security" />
        <Flag on={rowSecurity.forced} label="forçado para o dono" />
      </header>

      {rowSecurity.enabled && policies.length === 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-sev-warning">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          Ativo e sem nenhuma política: a tabela não devolve linha alguma, e sem erro nenhum.
        </p>
      )}

      <ul className="mt-2 space-y-2">
        {policies.map((policy) => (
          <li key={policy.id} className="rounded-lg bg-surface-2 p-2.5">
            <div className="flex flex-wrap items-center gap-x-2 text-[12px]">
              <span className="font-mono text-structure">{policy.name}</span>
              <span className="text-muted">
                {policy.command === 'all' ? 'todos os comandos' : policy.command}
              </span>
              <span className="text-muted">· para {policy.roles.join(', ')}</span>
              {!policy.permissive && (
                <span className="text-sev-warning" title="Restringe além das políticas permissivas">
                  · restritiva
                </span>
              )}
            </div>
            <dl className="mt-1 space-y-0.5 font-mono text-[11px]">
              <Expression term="using" title="quais linhas existem para quem lê">
                {policy.using}
              </Expression>
              <Expression term="with check" title="quais linhas podem ser gravadas">
                {policy.check}
              </Expression>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Expression({
  term,
  title,
  children,
}: {
  term: string;
  title: string;
  children: string | null;
}) {
  if (children === null) return null;
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-faint" title={title}>
        {term}
      </dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${on ? 'bg-accent/12 text-accent' : 'bg-surface-2 text-faint'}`}
    >
      {on ? label : `sem ${label}`}
    </span>
  );
}
