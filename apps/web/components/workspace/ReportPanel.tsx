'use client';

import type { Finding, Report } from '@sqlscope/security-rules';
import { severityOrder, SeverityTag } from '../ui/Severity';
import { useWorkspace } from './context';

/**
 * Security report of the current database: deterministic rules over the schema and its
 * privileges (ADR 0006). Every finding says what to do about it.
 */
export function ReportPanel() {
  const report = useWorkspace((s) => s.report);
  const buildReport = useWorkspace((s) => s.buildReport);
  const status = useWorkspace((s) => s.status);
  const loading = report.status === 'loading';

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => void buildReport()}
          disabled={loading || status !== 'ready'}
          className="rounded-md border border-accent px-2.5 py-1 text-[12px] text-accent hover:bg-accent hover:text-surface-0 disabled:opacity-50"
        >
          {loading ? 'Analisando…' : 'Analisar banco'}
        </button>
        {report.data && <Counts report={report.data} />}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {report.status === 'error' && (
          <p
            role="alert"
            className="m-3 rounded-md border border-sev-critical/40 bg-sev-critical/10 p-3 text-[13px] text-sev-critical"
          >
            ✕ {report.error}
          </p>
        )}
        {report.data === null && report.status !== 'error' && (
          <p className="p-4 text-[13px] text-muted">
            Verifica chaves, índices, privilégios e isolamento — as mesmas regras que você usaria
            revisando um banco de verdade.
          </p>
        )}
        {report.data && <Findings report={report.data} stale={report.stale} />}
      </div>
    </div>
  );
}

function Counts({ report }: { report: Report }) {
  const total = report.findings.length;
  const passed = report.checks.filter((c) => c.status === 'pass').length;
  const skipped = report.checks.filter((c) => c.status === 'skipped').length;

  return (
    <p className="text-[12px] text-muted">
      {total === 0 ? 'Nenhum achado' : `${total} achado(s)`} · {passed} regra(s) sem problema
      {skipped > 0 && ` · ${skipped} não avaliada(s)`}
    </p>
  );
}

function Findings({ report, stale }: { report: Report; stale: boolean }) {
  const byRule = new Map(report.checks.map((check) => [check.rule.id, check.rule]));

  return (
    <div className="p-3">
      {stale && (
        <p className="mb-3 text-[12px] text-sev-warning">
          △ O schema mudou desde este relatório. Analise de novo para atualizá-lo.
        </p>
      )}

      {report.findings.length === 0 ? (
        <p className="rounded-md border border-perf-gain/40 bg-perf-gain/10 p-3 text-[13px] text-perf-gain">
          ✓ Nenhuma regra encontrou problemas neste banco.
        </p>
      ) : (
        severityOrder.map((severity) => {
          const findings = report.findings.filter((f) => f.severity === severity);
          if (findings.length === 0) return null;
          return (
            <section key={severity} className="mb-4">
              <ul className="space-y-2">
                {findings.map((finding, i) => (
                  <FindingCard
                    key={`${finding.ruleId}-${i}`}
                    finding={finding}
                    name={byRule.get(finding.ruleId)?.name ?? finding.ruleId}
                    recommendation={byRule.get(finding.ruleId)?.recommendation ?? ''}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}

      <details className="mt-2 text-[12px] text-muted">
        <summary className="cursor-pointer">Regras verificadas ({report.checks.length})</summary>
        <ul className="mt-2 space-y-1">
          {report.checks.map((check) => (
            <li key={check.rule.id} className="flex items-baseline gap-2">
              <span
                aria-hidden
                className={
                  check.status === 'pass'
                    ? 'text-perf-gain'
                    : check.status === 'skipped'
                      ? 'text-faint'
                      : 'text-sev-high'
                }
              >
                {check.status === 'pass' ? '✓' : check.status === 'skipped' ? '–' : '✕'}
              </span>
              <span className="font-mono text-[11px] text-faint">{check.rule.id}</span>
              <span>{check.rule.name}</span>
              {check.status === 'skipped' && (
                <span className="text-faint">(sem acesso aos privilégios)</span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function FindingCard({
  finding,
  name,
  recommendation,
}: {
  finding: Finding;
  name: string;
  recommendation: string;
}) {
  return (
    <li className="rounded-md border border-border bg-surface-1 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityTag severity={finding.severity} />
        <span className="text-[13px] font-medium">{name}</span>
        <span className="font-mono text-[12px] text-structure">{finding.subject}</span>
        <span className="ml-auto font-mono text-[11px] text-faint">{finding.ruleId}</span>
      </div>
      <p className="mt-1 text-[12px] text-text">{finding.detail}</p>
      <p className="mt-1 text-[12px] text-muted">{recommendation}</p>
    </li>
  );
}
