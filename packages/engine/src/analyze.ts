import { err, ok, type Result, type SqlSession } from '@sqlscope/core';
import { parsePlan, planInsights, walk, type PlanInsight, type QueryPlan } from '@sqlscope/explain';
import { fingerprint, loadParser, parseScript } from '@sqlscope/sql-parser';
import { asDatabaseError } from '@sqlscope/core';

export interface QueryAnalysis {
  readonly sql: string;
  /** Identity of the query shape, so runs of "the same query" can be compared. */
  readonly fingerprint: string;
  readonly at: string;
  readonly plan: QueryPlan;
  readonly insights: readonly PlanInsight[];
  /** Server-reported execution time of each measured run, oldest first. */
  readonly samples: readonly number[];
  /** Median of `samples`; `null` when the query was only estimated. */
  readonly medianMs: number | null;
  /** Set when the plan is an estimate rather than a measurement. */
  readonly notMeasured: 'not-read-only' | null;
  readonly rows: number | null;
  /** How the data was reached: `Seq Scan em orders`, `Index Scan em orders_total on orders`. */
  readonly access: readonly string[];
}

export type AnalysisError =
  | { readonly kind: 'syntax'; readonly message: string }
  | { readonly kind: 'not-single-statement' }
  | { readonly kind: 'database'; readonly message: string; readonly code: string };

export interface AnalyzeOptions {
  /**
   * How many times to run the query. The first run is discarded: it pays for a cold cache
   * and would make every later comparison look like an improvement.
   */
  readonly runs?: number;
}

const DEFAULT_RUNS = 3;

/**
 * Explains a query and, when it only reads, measures it.
 *
 * `EXPLAIN ANALYZE` executes the statement for real, so it is limited to read-only
 * queries: rolling a write back would mean opening a transaction in a session where the
 * user may already have one of their own (see ADR 0005). Anything else gets the
 * planner's estimate, clearly marked as such.
 */
export async function analyzeQuery(
  session: SqlSession,
  sql: string,
  options: AnalyzeOptions = {},
): Promise<Result<QueryAnalysis, AnalysisError>> {
  await loadParser();
  const parsed = parseScript(sql);
  if (!parsed.ok) return err({ kind: 'syntax', message: parsed.error.message });
  if (parsed.value.length !== 1) return err({ kind: 'not-single-statement' });

  const statement = parsed.value[0]!;
  const readOnly = statement.kind === 'read';
  const runs = readOnly ? Math.max(1, options.runs ?? DEFAULT_RUNS) : 1;
  const samples: number[] = [];
  let plan: QueryPlan | undefined;

  for (let run = 0; run < runs; run++) {
    const explained = await explain(session, statement.text, readOnly);
    if (!explained.ok) return explained;
    plan = explained.value;
    if (plan.executionMs !== null) samples.push(plan.executionMs);
  }

  const measured = runs > 1 ? samples.slice(1) : samples;
  return ok({
    sql: statement.text,
    fingerprint: fingerprint(statement.text),
    at: new Date().toISOString(),
    plan: plan!,
    insights: planInsights(plan!),
    samples: measured,
    medianMs: measured.length > 0 ? median(measured) : null,
    notMeasured: readOnly ? null : 'not-read-only',
    rows: plan!.root.actual?.rows ?? null,
    access: accessPaths(plan!),
  });
}

async function explain(
  session: SqlSession,
  sql: string,
  analyze: boolean,
): Promise<Result<QueryPlan, AnalysisError>> {
  const options = analyze ? 'analyze, buffers, format json' : 'format json';
  try {
    const output = await session.execute(`explain (${options}) ${sql}`, {
      maxRows: 1,
      maxBytes: 20_000_000,
    });
    const json = output.rows[0]?.[0];
    if (typeof json !== 'string')
      return err({ kind: 'database', message: 'Plano vazio.', code: '' });
    const parsed = parsePlan(JSON.parse(json));
    return parsed.ok
      ? ok(parsed.value)
      : err({ kind: 'database', message: parsed.error, code: '' });
  } catch (thrown) {
    const error = asDatabaseError(thrown);
    if (!error) throw thrown;
    return err({ kind: 'database', message: error.message, code: error.code });
  }
}

/** Scan nodes, in plan order: the part of a plan an index actually changes. */
function accessPaths(plan: QueryPlan): string[] {
  return [...walk(plan.root)]
    .filter((node) => node.nodeType.includes('Scan'))
    .map((node) => (node.target ? `${node.nodeType} em ${node.target}` : node.nodeType));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return Math.round(value * 1000) / 1000;
}
