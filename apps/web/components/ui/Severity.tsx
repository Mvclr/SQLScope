import type { Severity } from '@sqlscope/security-rules';

/**
 * One severity scale for the whole product (docs/DESIGN.md): same icon, same word, same
 * colour in the analyzer, in query plans and in the labs. Colour never carries the
 * meaning on its own.
 */
const scale: Record<Severity, { icon: string; label: string; className: string }> = {
  info: { icon: '○', label: 'INFO', className: 'text-sev-info border-sev-info/40' },
  warning: { icon: '△', label: 'WARNING', className: 'text-sev-warning border-sev-warning/40' },
  high: { icon: '◆', label: 'HIGH', className: 'text-sev-high border-sev-high/40' },
  critical: { icon: '⬢', label: 'CRITICAL', className: 'text-sev-critical border-sev-critical/40' },
};

export function SeverityTag({ severity }: { severity: Severity }) {
  const { icon, label, className } = scale[severity];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 font-mono text-[10px] leading-5 ${className}`}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  );
}

export const severityOrder: readonly Severity[] = ['critical', 'high', 'warning', 'info'];

export const severityClass = (severity: Severity) => scale[severity].className;
