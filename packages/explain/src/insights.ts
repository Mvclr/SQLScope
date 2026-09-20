import { totalOf, walk, type PlanNode, type QueryPlan } from './plan.js';

/** Same severity scale as the rest of SQLScope (docs/DESIGN.md). */
export type Severity = 'info' | 'warning' | 'high';

export interface PlanInsight {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  /** Node the observation is about, as shown in the plan tree. */
  readonly node: string | null;
}

/** Below this, differences are noise rather than a lesson. */
const MIN_ROWS = 500;
const MISESTIMATION_FACTOR = 10;
const WASTED_FILTER_RATIO = 0.9;
const DOMINANT_NODE_SHARE = 0.5;
const MANY_LOOPS = 1_000;

/**
 * Reads a plan the way a reviewer would: where the time went, where the planner was
 * wrong, and what the query paid for that it did not need.
 *
 * Only for analyzed plans, except the first observation — without real numbers there is
 * nothing to compare against.
 */
export function planInsights(plan: QueryPlan): PlanInsight[] {
  if (!plan.analyzed) {
    return [
      {
        id: 'not-analyzed',
        severity: 'info',
        title: 'Plano estimado, não medido',
        detail:
          'Sem EXPLAIN ANALYZE os números são estimativas do planejador. Execute com medição para comparar com a realidade.',
        node: null,
      },
    ];
  }

  const nodes = [...walk(plan.root)];
  const insights: PlanInsight[] = [];
  const total = totalOf(plan.root);

  for (const node of nodes) {
    insights.push(
      ...misestimation(node),
      ...wastedScan(node),
      ...spilledToDisk(node),
      ...repeatedLoops(node),
    );
  }

  const dominant = [...nodes].sort((a, b) => (b.actual?.selfMs ?? 0) - (a.actual?.selfMs ?? 0))[0];
  if (dominant && total > 0 && (dominant.actual?.selfMs ?? 0) / total >= DOMINANT_NODE_SHARE) {
    insights.push({
      id: 'dominant-node',
      severity: 'info',
      title: `${describe(dominant)} concentra o tempo`,
      detail: `${format(dominant.actual!.selfMs)} ms dos ${format(total)} ms da consulta acontecem nesse nó.`,
      node: describe(dominant),
    });
  }

  return insights;
}

/** The planner's estimate against what really came out. */
function misestimation(node: PlanNode): PlanInsight[] {
  const actual = node.actual;
  if (!actual || Math.max(actual.rows, node.estimated.rows) < MIN_ROWS) return [];
  const estimated = Math.max(node.estimated.rows, 1);
  const rows = Math.max(actual.rows, 1);
  const factor = Math.max(rows / estimated, estimated / rows);
  if (factor < MISESTIMATION_FACTOR) return [];

  return [
    {
      id: 'misestimation',
      severity: 'warning',
      title: `Estimativa ${rows > estimated ? 'muito abaixo' : 'muito acima'} do real em ${describe(node)}`,
      detail: `O planejador esperava ${estimated.toLocaleString('pt-BR')} linha(s) e vieram ${actual.rows.toLocaleString('pt-BR')}. Estatísticas desatualizadas levam a planos ruins — ANALYZE costuma resolver.`,
      node: describe(node),
    },
  ];
}

/** Rows read from disk only to be thrown away by a filter. */
function wastedScan(node: PlanNode): PlanInsight[] {
  const removed = node.rowsRemovedByFilter;
  const actual = node.actual;
  if (!actual || removed === null || !node.nodeType.includes('Seq Scan')) return [];
  const read = removed + actual.rows;
  if (read < MIN_ROWS || removed / read < WASTED_FILTER_RATIO) return [];

  return [
    {
      id: 'wasted-seq-scan',
      severity: 'high',
      title: `${describe(node)} lê muito mais do que usa`,
      detail: `${removed.toLocaleString('pt-BR')} de ${read.toLocaleString('pt-BR')} linhas foram lidas e descartadas pelo filtro ${node.details['Filter'] ?? ''}. Um índice sobre essa condição evitaria a leitura.`,
      node: describe(node),
    },
  ];
}

/** Sorts and hashes that ran out of memory and went to disk. */
function spilledToDisk(node: PlanNode): PlanInsight[] {
  const onDisk = node.sort?.spaceType === 'Disk';
  const temp = (node.buffers?.tempWritten ?? 0) > 0;
  if (!onDisk && !temp) return [];

  return [
    {
      id: 'spilled-to-disk',
      severity: 'warning',
      title: `${describe(node)} usou disco`,
      detail: onDisk
        ? `A ordenação não coube em memória (${node.sort!.spaceKb.toLocaleString('pt-BR')} kB, método ${node.sort!.method}). Ordenar menos linhas, ou um índice que já entregue a ordem, evita isso.`
        : 'O nó escreveu blocos temporários em disco por falta de memória de trabalho.',
      node: describe(node),
    },
  ];
}

/** A node executed once per row of the other side of a join. */
function repeatedLoops(node: PlanNode): PlanInsight[] {
  const actual = node.actual;
  if (!actual || actual.loops < MANY_LOOPS) return [];

  return [
    {
      id: 'many-loops',
      severity: 'info',
      title: `${describe(node)} rodou ${actual.loops.toLocaleString('pt-BR')} vezes`,
      detail: `Cada execução custa pouco, mas somadas dão ${format(actual.totalMs)} ms. É o padrão N+1 dentro do banco.`,
      node: describe(node),
    },
  ];
}

const describe = (node: PlanNode): string =>
  node.target ? `${node.nodeType} em ${node.target}` : node.nodeType;

const format = (ms: number) => ms.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
