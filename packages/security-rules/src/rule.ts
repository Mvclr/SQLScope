import type { DatabasePrivileges, SchemaSnapshot } from '@sqlscope/core';

/** Same scale everywhere in SQLScope (docs/DESIGN.md). */
export type Severity = 'info' | 'warning' | 'high' | 'critical';

export type Category = 'privileges' | 'isolation' | 'schema' | 'performance';

/**
 * Everything a rule may look at, gathered once (ADR 0006). Rules are pure functions of
 * this: no database access, no I/O, so they run on the server and in the browser alike.
 */
export interface AnalysisContext {
  readonly snapshot: SchemaSnapshot;
  /**
   * `null` when privileges could not be read — an imported schema, for instance.
   * Rules that need them declare `needsPrivileges` and are skipped instead of guessing.
   */
  readonly privileges: DatabasePrivileges | null;
}

export interface Finding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly category: Category;
  /** What the finding is about: `public.orders`, a role name, an index. */
  readonly subject: string;
  /** One sentence stating the problem, in the user's language. */
  readonly detail: string;
}

export interface SecurityRule {
  readonly id: string;
  readonly name: string;
  readonly severity: Severity;
  readonly category: Category;
  /** Why it matters and what to do about it. Shown next to the findings. */
  readonly recommendation: string;
  readonly needsPrivileges?: boolean;
  check(context: AnalysisContext): Finding[];
}

export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface CheckResult {
  readonly rule: Omit<SecurityRule, 'check'>;
  readonly status: CheckStatus;
  readonly findings: readonly Finding[];
}

export interface Report {
  readonly checks: readonly CheckResult[];
  readonly findings: readonly Finding[];
  readonly counts: Readonly<Record<Severity, number>>;
}

export const qualified = (schema: string, name: string): string =>
  schema === 'public' ? name : `${schema}.${name}`;
