'use client';

import type { QueryAnalysis } from '@sqlscope/engine';
import { compareAnalyses } from '@sqlscope/engine/display';
import type { PlanNode } from '@sqlscope/explain';
import { SeverityTag } from '../ui/Severity';
import { useWorkspace } from './context';

const ms = (value: number | null) =>
  value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ms`;

const rows = (value: number | null) => (value === null ? '—' : value.toLocaleString('pt-BR'));

/**
 * What the database did with a query: the plan, what stands out in it, and how it
 * compares with the last time the same query was measured (docs/ROADMAP.md, fase 2).
 */
export function PlanPanel() {
  const analysis = useWorkspace((s) => s.analysis);
  const analyzeQuery = useWorkspace((s) => s.analyzeQuery);
  const status = useWorkspace((s) => s.status);
  const loading = analysis.status === 'loading';

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => void analyzeQuery()}
          disabled={loading || status !== 'ready'}
          className="rounded-md border border-accent px-2.5 py-1 text-[12px] text-accent hover:bg-accent hover:text-surface-0 disabled:opacity-50"
        >
          {loading ? 'Analisando…' : 'Analisar consulta'}
        </button>
        <span className="text-[12px] text-faint">
          Executa a consulta do editor algumas vezes e mede o tempo.
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {analysis.status === 'error' && (
          <p
            role="alert"
            className="m-3 rounded-md border border-sev-critical/40 bg-sev-critical/10 p-3 text-[13px] text-sev-critical"
          >
            ✕ {analysis.error}
          </p>
        )}
        {analysis.data === null && analysis.status !== 'error' && (
          <p className="p-4 text-[13px] text-muted">
            Escreva uma consulta e clique em <strong>Analisar consulta</strong> para ver o plano de
            execução, o tempo real e o que o banco fez com ela.
          </p>
        )}
        {analysis.data && (
          <div className="p-3">
            {analysis.stale && (
              <p className="mb-3 text-[12px] text-sev-warning">
                △ O schema mudou desde esta análise. Analise de novo para ver o efeito.
              </p>
            )}
            {analysis.data.previous && (
              <Comparison before={analysis.data.previous} after={analysis.data.analysis} />
            )}
            <Summary analysis={analysis.data.analysis} />
            <Insights analysis={analysis.data.analysis} />
            <h3 className="mb-2 mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">
              Plano de execução
            </h3>
            <PlanTree
              node={analysis.data.analysis.plan.root}
              total={analysis.data.analysis.plan.root.actual?.totalMs ?? 0}
              depth={0}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Before and after — the point of creating an index (docs/DESIGN.md: green means faster). */
function Comparison({ before, after }: { before: QueryAnalysis; after: QueryAnalysis }) {
  const { speedup, significant, accessChanged } = compareAnalyses(before, after);
  // Two runs of a few microseconds differ by chance; only a real difference is claimed.
  const faster = significant && speedup !== null && speedup > 1;
  const slower = significant && speedup !== null && speedup < 1;

  return (
    <section
      aria-label="Comparação com a análise anterior"
      className={`mb-4 rounded-md border p-3 ${faster ? 'border-perf-gain/40 bg-perf-gain/10' : 'border-border bg-surface-2'}`}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-faint">Antes</p>
          <p className="font-mono text-[13px]">{ms(before.medianMs)}</p>
          <p className="mt-1 font-mono text-[11px] text-muted">
            {before.access.join(' · ') || '—'}
          </p>
        </div>
        <div
          className={`text-center font-mono text-[13px] ${faster ? 'text-perf-gain' : slower ? 'text-sev-warning' : 'text-muted'}`}
        >
          {speedup === null
            ? '→'
            : faster
              ? `${speedup.toFixed(1)}× mais rápido`
              : slower
                ? `${(1 / speedup).toFixed(1)}× mais lento`
                : 'sem diferença mensurável'}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-faint">Depois</p>
          <p className="font-mono text-[13px]">{ms(after.medianMs)}</p>
          <p className="mt-1 font-mono text-[11px] text-muted">{after.access.join(' · ') || '—'}</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        Mediana de execuções repetidas, descartando a primeira (cache frio). É uma medida
        indicativa, não um benchmark.
        {!significant &&
          !accessChanged &&
          ' Em tabelas pequenas os dois tempos são curtos demais para comparar: a diferença é ruído.'}
      </p>
    </section>
  );
}

function Summary({ analysis }: { analysis: QueryAnalysis }) {
  const buffers = analysis.plan.root.buffers;
  const items: [string, string][] = [
    ['Tempo (mediana)', analysis.notMeasured ? 'não medido' : ms(analysis.medianMs)],
    ['Planejamento', ms(analysis.plan.planningMs)],
    ['Linhas', rows(analysis.rows)],
    ['Custo estimado', analysis.plan.root.cost.total.toLocaleString('pt-BR')],
    ...(buffers
      ? ([['Blocos (cache/disco)', `${buffers.sharedHit} / ${buffers.sharedRead}`]] as [
          string,
          string,
        ][])
      : []),
  ];

  return (
    <>
      {analysis.notMeasured === 'not-read-only' && (
        <p className="mb-3 rounded-md border border-sev-warning/40 bg-sev-warning/10 p-2 text-[12px] text-sev-warning">
          △ Esta instrução escreve no banco. O plano é a estimativa do planejador: medir exigiria
          executá-la de verdade.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
            <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
            <dd className="font-mono text-[13px] tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Insights({ analysis }: { analysis: QueryAnalysis }) {
  if (analysis.insights.length === 0) return null;
  return (
    <ul className="mt-4 space-y-2">
      {analysis.insights.map((insight, i) => (
        <li key={i} className="flex gap-2 rounded-md border border-border bg-surface-1 p-2.5">
          <SeverityTag severity={insight.severity} />
          <div className="min-w-0">
            <p className="text-[13px] font-medium">{insight.title}</p>
            <p className="text-[12px] text-muted">{insight.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The plan as PostgreSQL nests it, with a bar showing where the time went. */
function PlanTree({ node, total, depth }: { node: PlanNode; total: number; depth: number }) {
  const share = total > 0 && node.actual ? node.actual.selfMs / total : 0;
  const details = Object.entries(node.details);

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 16 }}>
      <div
        className="border-l border-border py-1 pl-2"
        style={{ borderLeftWidth: depth === 0 ? 0 : 1 }}
      >
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12px] text-text">
            {node.nodeType}
            {node.strategy && <span className="text-muted"> ({node.strategy})</span>}
            {node.target && <span className="text-structure"> em {node.target}</span>}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">
            {node.actual
              ? `${ms(node.actual.totalMs)} · ${rows(node.actual.rows)} linhas`
              : `est. ${rows(node.estimated.rows)} linhas`}
          </span>
        </div>
        {share > 0 && (
          <div
            className="mt-0.5 h-1 w-full overflow-hidden rounded bg-surface-2"
            title={`${Math.round(share * 100)}% do tempo neste nó`}
          >
            <div className="h-full bg-accent" style={{ width: `${Math.max(2, share * 100)}%` }} />
          </div>
        )}
        {details.length > 0 && (
          <dl className="mt-0.5 font-mono text-[11px] text-faint">
            {details.map(([key, value]) => (
              <div key={key} className="flex gap-1">
                <dt className="shrink-0">{key}:</dt>
                <dd className="truncate" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {node.children.map((child, i) => (
        <PlanTree key={i} node={child} total={total} depth={depth + 1} />
      ))}
    </div>
  );
}
