'use client';

import type { StatementResult } from '@sqlscope/engine';
import { Check, CircleX, Globe, Server, Table2, TriangleAlert, X } from 'lucide-react';
import { EmptyState, Kbd } from '../ui/EmptyState';
import { useWorkspace } from './context';
import { ResultGrid } from './ResultGrid';

function summary(statement: StatementResult): string {
  if (statement.status === 'error') return `Erro ${statement.error.code}`;
  const { command, rowCount, truncated, columns } = statement.output;
  if (truncated) return `${statement.output.rows.length}+ linhas (truncado)`;
  if (columns.length > 0) return `${rowCount ?? statement.output.rows.length} linha(s)`;
  if (rowCount !== null) return `${command} · ${rowCount} linha(s)`;
  return command ?? 'OK';
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('--')) ?? text;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

export function ResultsPanel() {
  const runs = useWorkspace((s) => s.runs);
  const selectedRun = useWorkspace((s) => s.selectedRun);
  const selectedStatement = useWorkspace((s) => s.selectedStatement);
  const selectStatement = useWorkspace((s) => s.selectStatement);
  const tier = useWorkspace((s) => s.tier);
  const run = runs.find((r) => r.id === selectedRun);

  if (!run) {
    return (
      <EmptyState icon={Table2}>
        Execute o script com <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd>. Os resultados aparecem aqui.
      </EmptyState>
    );
  }

  const { result } = run;
  if (result.syntaxError) {
    return (
      <div className="p-4">
        <ErrorCard
          title="Erro de sintaxe — nada foi executado"
          message={result.syntaxError.message}
        />
      </div>
    );
  }

  const statement = result.statements[selectedStatement];
  const totalMs = result.statements.reduce((sum, s) => sum + s.durationMs, 0);

  return (
    <div className="flex h-full min-h-0">
      <ol
        className="w-56 shrink-0 space-y-0.5 overflow-auto border-r border-border p-1.5"
        aria-label="Statements executados"
      >
        {result.statements.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => selectStatement(i)}
              aria-current={i === selectedStatement}
              className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 ${i === selectedStatement ? 'bg-surface-2' : ''}`}
            >
              <span className="flex w-full items-center gap-1.5 text-[12px]">
                {s.status === 'ok' ? (
                  <Check aria-hidden className="size-3.5 shrink-0 text-muted" />
                ) : (
                  <X aria-hidden className="size-3.5 shrink-0 text-sev-critical" />
                )}
                <span className={s.status === 'ok' ? 'text-text' : 'text-sev-critical'}>
                  {summary(s)}
                </span>
                <span className="ml-auto text-[11px] tabular-nums text-faint">
                  {s.durationMs} ms
                </span>
              </span>
              <span className="w-full truncate font-mono text-[11px] text-faint">
                {firstLine(s.text)}
              </span>
            </button>
          </li>
        ))}
        {result.skipped > 0 && (
          <li className="px-2.5 py-1.5 text-[12px] text-faint">
            {result.skipped} não executado(s) após o erro
          </li>
        )}
      </ol>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-3 py-1.5 text-[12px] text-muted">
          <span className="truncate tabular-nums">
            {result.statements.length} statement(s) · {Math.round(totalMs * 100) / 100} ms
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-faint">
            {tier === 'T0' ? (
              <Globe aria-hidden className="size-3" />
            ) : (
              <Server aria-hidden className="size-3" />
            )}
            {tier === 'T0' ? 'PGlite · no navegador' : 'PostgreSQL · servidor'}
          </span>
        </div>
        {result.schemaUnknown && (
          <p className="flex items-center gap-1.5 border-b border-border bg-sev-warning/10 px-3 py-1.5 text-[12px] text-sev-warning">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            <span>
              A transação está em estado de erro: o schema só pode ser lido de novo após{' '}
              <code className="font-mono">ROLLBACK</code>.
            </span>
          </p>
        )}
        <div className="min-h-0 flex-1">
          {statement && <StatementDetail statement={statement} />}
        </div>
      </div>
    </div>
  );
}

function StatementDetail({ statement }: { statement: StatementResult }) {
  if (statement.status === 'error') {
    const { message, code, detail, hint } = statement.error;
    return (
      <div className="p-4">
        <ErrorCard title={`${code} · ${message}`} message={detail} hint={hint} />
      </div>
    );
  }
  const { output } = statement;
  if (output.columns.length === 0) {
    return <p className="p-4 font-mono text-[13px] text-muted">{summary(statement)}</p>;
  }
  return (
    <div className="flex h-full flex-col">
      {output.truncated && (
        <p className="flex items-center gap-1.5 border-b border-border px-3 py-1 text-[12px] text-sev-warning">
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          Mostrando {output.rows.length} linhas — limite de{' '}
          {output.truncated === 'rows' ? 'linhas' : 'tamanho'} da sessão.
        </p>
      )}
      <div className="min-h-0 flex-1">
        <ResultGrid output={output} />
      </div>
    </div>
  );
}

function ErrorCard({
  title,
  message,
  hint,
}: {
  title: string;
  message?: string | null;
  hint?: string | null;
}) {
  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-xl border border-sev-critical/30 bg-sev-critical/8 p-3 text-[13px]"
    >
      <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-sev-critical" />
      <div className="min-w-0">
        <p className="font-medium text-sev-critical">{title}</p>
        {message && <p className="mt-1 text-text">{message}</p>}
        {hint && <p className="mt-1 text-muted">Dica: {hint}</p>}
      </div>
    </div>
  );
}
