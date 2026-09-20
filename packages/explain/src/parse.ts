import { err, ok, type Result } from '@sqlscope/core';
import type { ActualStats, Buffers, PlanNode, QueryPlan, SortInfo, TriggerTiming } from './plan.js';

type Raw = Record<string, unknown>;

const num = (raw: Raw, key: string): number | null => {
  const value = raw[key];
  return typeof value === 'number' ? value : null;
};

const str = (raw: Raw, key: string): string | null => {
  const value = raw[key];
  return typeof value === 'string' ? value : null;
};

/**
 * Labels PostgreSQL attaches to a node as free text. Kept as given, so the UI can show
 * exactly what the server said.
 */
const DETAIL_KEYS = [
  'Filter',
  'Index Cond',
  'Recheck Cond',
  'Join Filter',
  'Hash Cond',
  'Merge Cond',
  'TID Cond',
  'Sort Key',
  'Group Key',
  'Presorted Key',
  'Hash Key',
  'One-Time Filter',
  'Subplan Name',
  'Cache Key',
  'Function Call',
  'Conflict Arbiter Indexes',
  'Conflict Filter',
] as const;

/**
 * Parses the JSON produced by `EXPLAIN (FORMAT JSON)`.
 *
 * Accepts the array PostgreSQL returns, or the single plan object inside it, already
 * parsed from text.
 */
export function parsePlan(json: unknown): Result<QueryPlan, string> {
  const root = Array.isArray(json) ? json[0] : json;
  if (!isRecord(root)) return err('Plano vazio ou em formato inesperado.');
  const plan = root['Plan'];
  if (!isRecord(plan)) return err('O plano não contém o nó raiz ("Plan").');

  const node = parseNode(plan);
  return ok({
    root: node,
    analyzed: node.actual !== null,
    planningMs: num(root, 'Planning Time'),
    executionMs: num(root, 'Execution Time'),
    triggers: parseTriggers(root['Triggers']),
  });
}

function parseNode(raw: Raw, relationship: string | null = null): PlanNode {
  const children = Array.isArray(raw['Plans'])
    ? raw['Plans']
        .filter(isRecord)
        .map((child) => parseNode(child, str(child, 'Parent Relationship')))
    : [];

  const actual = parseActual(raw, children);
  return {
    nodeType: str(raw, 'Node Type') ?? 'Unknown',
    target: parseTarget(raw),
    strategy: parseStrategy(raw),
    cost: { startup: num(raw, 'Startup Cost') ?? 0, total: num(raw, 'Total Cost') ?? 0 },
    estimated: { rows: num(raw, 'Plan Rows') ?? 0, width: num(raw, 'Plan Width') ?? 0 },
    actual,
    buffers: parseBuffers(raw),
    details: parseDetails(raw),
    rowsRemovedByFilter: num(raw, 'Rows Removed by Filter'),
    sort: parseSort(raw),
    workers: parseWorkers(raw),
    relationship,
    subplanName: str(raw, 'Subplan Name'),
    children,
  };
}

function parseActual(raw: Raw, children: readonly PlanNode[]): ActualStats | null {
  const perLoop = num(raw, 'Actual Rows');
  const loops = num(raw, 'Actual Loops');
  const totalPerLoop = num(raw, 'Actual Total Time');
  if (perLoop === null || loops === null || totalPerLoop === null) return null;

  // PostgreSQL reports per-loop averages; the useful number is the total.
  const totalMs = round(totalPerLoop * loops);
  const childrenMs = children.reduce((sum, child) => sum + (child.actual?.totalMs ?? 0), 0);
  return {
    rows: Math.round(perLoop * loops),
    loops,
    totalMs,
    selfMs: round(Math.max(0, totalMs - childrenMs)),
  };
}

function parseBuffers(raw: Raw): Buffers | null {
  const sharedHit = num(raw, 'Shared Hit Blocks');
  if (sharedHit === null) return null;
  return {
    sharedHit,
    sharedRead: num(raw, 'Shared Read Blocks') ?? 0,
    sharedDirtied: num(raw, 'Shared Dirtied Blocks') ?? 0,
    sharedWritten: num(raw, 'Shared Written Blocks') ?? 0,
    tempRead: num(raw, 'Temp Read Blocks') ?? 0,
    tempWritten: num(raw, 'Temp Written Blocks') ?? 0,
  };
}

function parseDetails(raw: Raw): Record<string, string> {
  const details: Record<string, string> = {};
  for (const key of DETAIL_KEYS) {
    const value = raw[key];
    if (typeof value === 'string') details[key] = value;
    else if (Array.isArray(value) && value.length > 0) details[key] = value.join(', ');
  }
  return details;
}

function parseSort(raw: Raw): SortInfo | null {
  const method = str(raw, 'Sort Method');
  if (method === null) return null;
  return {
    method,
    spaceKb: num(raw, 'Sort Space Used') ?? 0,
    spaceType: str(raw, 'Sort Space Type') ?? 'Memory',
  };
}

function parseWorkers(raw: Raw): PlanNode['workers'] {
  const planned = num(raw, 'Workers Planned');
  if (planned === null) return null;
  return { planned, launched: num(raw, 'Workers Launched') };
}

/** What the node touches, as PostgreSQL would print it after `on`. */
function parseTarget(raw: Raw): string | null {
  const relation = str(raw, 'Relation Name');
  const alias = str(raw, 'Alias');
  const index = str(raw, 'Index Name');
  const cte = str(raw, 'CTE Name');
  const relationPart = relation && alias && alias !== relation ? `${relation} ${alias}` : relation;

  if (index && relationPart) return `${index} on ${relationPart}`;
  return index ?? relationPart ?? cte ?? str(raw, 'Function Name') ?? null;
}

/** The qualifier PostgreSQL prints next to the node type, when there is one. */
function parseStrategy(raw: Raw): string | null {
  const join = str(raw, 'Join Type');
  const strategy = str(raw, 'Strategy');
  const direction = str(raw, 'Scan Direction');
  const operation = str(raw, 'Operation');
  if (join && join !== 'Inner') return join;
  if (strategy && strategy !== 'Plain') return strategy;
  if (direction && direction !== 'Forward') return direction;
  return operation;
}

function parseTriggers(value: unknown): TriggerTiming[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((raw) => ({
    name: str(raw, 'Trigger Name') ?? 'trigger',
    relation: str(raw, 'Relation'),
    timeMs: num(raw, 'Time') ?? 0,
    calls: num(raw, 'Calls') ?? 0,
  }));
}

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const round = (value: number) => Math.round(value * 1000) / 1000;
