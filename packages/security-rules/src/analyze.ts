import type { SqlExecutor } from '@sqlscope/core';
import { introspect, readPrivileges } from '@sqlscope/core';
import { rules } from './rules.js';
import type { AnalysisContext, CheckResult, Report, Severity } from './rule.js';

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, warning: 2, info: 3 };

/**
 * Runs every rule over a context that was gathered once.
 *
 * Rules that need privileges are reported as skipped — not as passing — when the context
 * has none: a check that did not run has not found anything.
 */
export function analyze(context: AnalysisContext): Report {
  const checks: CheckResult[] = rules.map((rule) => {
    const { check, ...description } = rule;
    if (rule.needsPrivileges && context.privileges === null) {
      return { rule: description, status: 'skipped', findings: [] };
    }
    const findings = check(context);
    return { rule: description, status: findings.length > 0 ? 'fail' : 'pass', findings };
  });

  const findings = checks
    .flatMap((check) => check.findings)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.ruleId.localeCompare(b.ruleId) ||
        a.subject.localeCompare(b.subject),
    );

  const counts: Record<Severity, number> = { critical: 0, high: 0, warning: 0, info: 0 };
  for (const item of findings) counts[item.severity] += 1;

  return { checks, findings, counts };
}

/** Convenience for callers holding a database: reads the context, then analyses it. */
export async function analyzeDatabase(db: SqlExecutor): Promise<Report> {
  const [snapshot, privileges] = [await introspect(db), await readPrivileges(db)];
  return analyze({ snapshot, privileges });
}
