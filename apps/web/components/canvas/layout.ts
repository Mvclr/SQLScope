import type { SchemaSnapshot, TableSnapshot } from '@sqlscope/core';
import type { Point } from '../workspace/store';

export const NODE_WIDTH = 260;
const HEADER_HEIGHT = 38;
const ROW_HEIGHT = 26;
const GAP_X = 90;
const GAP_Y = 36;

export const nodeHeight = (table: TableSnapshot) =>
  HEADER_HEIGHT + ROW_HEIGHT * table.columns.length + 8;

interface Relation {
  /** The table holding the foreign key. */
  readonly child: string;
  /** The table it references. */
  readonly parent: string;
}

export function relationsOf(snapshot: SchemaSnapshot): Relation[] {
  const idOf = new Map(snapshot.tables.map((t) => [`${t.schema}.${t.name}`, t.id]));
  return snapshot.tables.flatMap((table) =>
    table.constraints.flatMap((c) => {
      if (c.kind !== 'foreign key') return [];
      const parent = idOf.get(`${c.references.schema}.${c.references.name}`);
      return parent && parent !== table.id ? [{ child: table.id, parent }] : [];
    }),
  );
}

/** Full layered layout: referenced tables to the left of the tables that reference them. */
export async function layoutAll(snapshot: SchemaSnapshot): Promise<Record<string, Point>> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const graph = await new ELK().layout({
    id: 'schema',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': String(GAP_Y),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(GAP_X),
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children: snapshot.tables.map((t) => ({ id: t.id, width: NODE_WIDTH, height: nodeHeight(t) })),
    edges: relationsOf(snapshot).map((r, i) => ({
      id: `e${i}`,
      sources: [r.parent],
      targets: [r.child],
    })),
  });
  return Object.fromEntries(
    (graph.children ?? []).map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
  );
}

/**
 * Positions only the tables that have none. Existing positions are never touched — the
 * user may have arranged them (DESIGN.md › Schema canvas).
 */
export function placeNewTables(
  snapshot: SchemaSnapshot,
  positions: Readonly<Record<string, Point>>,
): Record<string, Point> {
  const placed: Record<string, Point> = {};
  const sizes = new Map(snapshot.tables.map((t) => [t.id, { w: NODE_WIDTH, h: nodeHeight(t) }]));
  const relations = relationsOf(snapshot);
  const known = () => ({ ...positions, ...placed });

  const overlaps = (id: string, at: Point) => {
    const size = sizes.get(id)!;
    return Object.entries(known()).some(([other, p]) => {
      const o = sizes.get(other);
      if (!o || other === id) return false;
      return (
        at.x < p.x + o.w + GAP_X / 2 &&
        at.x + size.w + GAP_X / 2 > p.x &&
        at.y < p.y + o.h + GAP_Y &&
        at.y + size.h + GAP_Y > p.y
      );
    });
  };

  for (const table of snapshot.tables) {
    if (positions[table.id]) continue;
    const all = known();
    const parent = relations.find((r) => r.child === table.id && all[r.parent])?.parent;
    const child = relations.find((r) => r.parent === table.id && all[r.child])?.child;

    let at: Point;
    if (parent) at = { x: all[parent]!.x + NODE_WIDTH + GAP_X, y: all[parent]!.y };
    else if (child) at = { x: all[child]!.x - NODE_WIDTH - GAP_X, y: all[child]!.y };
    else {
      const points = Object.values(all);
      at = points.length
        ? {
            x: Math.max(...points.map((p) => p.x)) + NODE_WIDTH + GAP_X,
            y: Math.min(...points.map((p) => p.y)),
          }
        : { x: 0, y: 0 };
    }
    while (overlaps(table.id, at)) at = { x: at.x, y: at.y + GAP_Y };
    placed[table.id] = at;
  }
  return placed;
}
