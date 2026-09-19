'use client';

import { useWorkspace } from './context';

const time = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Every script run in this session, newest first. Clicking one brings back its results. */
export function HistoryPanel() {
  const runs = useWorkspace((s) => s.runs);
  const selectedRun = useWorkspace((s) => s.selectedRun);
  const selectRun = useWorkspace((s) => s.selectRun);
  const setSql = useWorkspace((s) => s.setSql);

  if (runs.length === 0) return <p className="p-4 text-[13px] text-muted">Nada executado ainda.</p>;

  return (
    <ol className="h-full overflow-auto py-1">
      {[...runs].reverse().map((run) => {
        const failed =
          run.result.syntaxError || run.result.statements.some((s) => s.status === 'error');
        const changes = run.result.schema?.changes.length ?? 0;
        return (
          <li
            key={run.id}
            className={`group border-b border-border/50 ${run.id === selectedRun ? 'bg-surface-2' : ''}`}
          >
            <button
              type="button"
              onClick={() => selectRun(run.id)}
              className="w-full px-3 py-2 text-left hover:bg-surface-2"
            >
              <span className="flex items-center gap-2 text-[12px]">
                <span className="tabular-nums text-faint">{time.format(run.at)}</span>
                <span className={failed ? 'text-sev-critical' : 'text-muted'}>
                  {failed ? '✕ falhou' : `✓ ${run.result.statements.length} statement(s)`}
                </span>
                {changes > 0 && (
                  <span className="text-accent">· {changes} mudança(s) no schema</span>
                )}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-faint">
                {run.sql.trim().split('\n')[0]}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSql(run.sql)}
              className="px-3 pb-2 text-[11px] text-structure opacity-0 hover:underline focus:opacity-100 group-hover:opacity-100"
            >
              Trazer de volta para o editor
            </button>
          </li>
        );
      })}
    </ol>
  );
}
