/**
 * Shape of a parsed `EXPLAIN (FORMAT JSON)` plan.
 *
 * Field names follow the meaning, not PostgreSQL's spelling: `estimated`/`actual` instead
 * of `Plan Rows`/`Actual Rows`, and totals instead of per-loop averages.
 */
export interface QueryPlan {
  readonly root: PlanNode;
  /** True when the statement was really executed (`EXPLAIN ANALYZE`). */
  readonly analyzed: boolean;
  readonly planningMs: number | null;
  readonly executionMs: number | null;
  readonly triggers: readonly TriggerTiming[];
}

export interface PlanNode {
  /** `Seq Scan`, `Hash Join`, `Aggregate`, ... */
  readonly nodeType: string;
  /** What the node reads, when it reads a relation: table, index or CTE. */
  readonly target: string | null;
  /** Extra qualifier shown next to the type: join type, aggregate strategy, scan direction. */
  readonly strategy: string | null;
  readonly cost: { readonly startup: number; readonly total: number };
  readonly estimated: { readonly rows: number; readonly width: number };
  /** Totals across every loop; `null` unless the plan was analyzed. */
  readonly actual: ActualStats | null;
  readonly buffers: Buffers | null;
  /** Conditions and keys, keyed by their PostgreSQL label (`Filter`, `Index Cond`, ...). */
  readonly details: Readonly<Record<string, string>>;
  readonly rowsRemovedByFilter: number | null;
  readonly sort: SortInfo | null;
  readonly workers: { readonly planned: number; readonly launched: number | null } | null;
  /** `Outer`, `Inner`, `SubPlan`, `InitPlan`... as reported by PostgreSQL. */
  readonly relationship: string | null;
  readonly subplanName: string | null;
  readonly children: readonly PlanNode[];
}

export interface ActualStats {
  /** Rows produced in total: PostgreSQL reports the per-loop average. */
  readonly rows: number;
  readonly loops: number;
  /** Elapsed time of this node across every loop. */
  readonly totalMs: number;
  /** Time spent inside this node alone, with children's time removed. */
  readonly selfMs: number;
}

export interface Buffers {
  readonly sharedHit: number;
  readonly sharedRead: number;
  readonly sharedDirtied: number;
  readonly sharedWritten: number;
  readonly tempRead: number;
  readonly tempWritten: number;
}

export interface SortInfo {
  readonly method: string;
  readonly spaceKb: number;
  /** `Memory` or `Disk`. */
  readonly spaceType: string;
}

export interface TriggerTiming {
  readonly name: string;
  readonly relation: string | null;
  readonly timeMs: number;
  readonly calls: number;
}

/** Sum of a node's own work and everything below it. */
export const totalOf = (node: PlanNode): number => node.actual?.totalMs ?? 0;

/** Walks the tree, parents before children. */
export function* walk(node: PlanNode): Generator<PlanNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}
