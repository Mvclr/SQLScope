'use client';

import type { SchemaSnapshot } from '@sqlscope/core';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { Database, History, LayoutGrid } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buttonClass } from '../ui/button';
import { useWorkspace } from '../workspace/context';
import type { Highlights, Point } from '../workspace/store';
import { ExportMenu } from './ExportMenu';
import { ForeignKeyEdge, type ForeignKeyEdgeType } from './ForeignKeyEdge';
import { layoutAll, placeNewTables } from './layout';
import { TableNode, type TableNodeType } from './TableNode';

const nodeTypes = { table: TableNode };
const edgeTypes = { foreignKey: ForeignKeyEdge };

function toNodes(
  snapshot: SchemaSnapshot,
  positions: Record<string, Point>,
  highlights: Highlights,
): TableNodeType[] {
  return snapshot.tables.flatMap((table) => {
    const position = positions[table.id];
    if (!position) return [];
    return [
      {
        id: table.id,
        type: 'table' as const,
        position,
        data: {
          table,
          stamp: highlights.stamp,
          born: highlights.bornTables.has(table.id),
          changed: highlights.changedTables.has(table.id),
          bornColumns: highlights.bornColumns,
          changedColumns: highlights.changedColumns,
        },
      },
    ];
  });
}

function toEdges(snapshot: SchemaSnapshot, highlights: Highlights): ForeignKeyEdgeType[] {
  const idOf = new Map(snapshot.tables.map((t) => [`${t.schema}.${t.name}`, t.id]));
  return snapshot.tables.flatMap((table) =>
    table.constraints.flatMap((constraint): ForeignKeyEdgeType[] => {
      if (constraint.kind !== 'foreign key') return [];
      const parent = idOf.get(`${constraint.references.schema}.${constraint.references.name}`);
      const [column] = constraint.columns;
      const [referenced] = constraint.references.columns;
      if (!parent || !column || !referenced) return [];
      const unique = table.constraints.some(
        (c) =>
          (c.kind === 'unique' || c.kind === 'primary key') &&
          c.columns.length === constraint.columns.length &&
          c.columns.every((col) => constraint.columns.includes(col)),
      );
      return [
        {
          id: constraint.id,
          type: 'foreignKey',
          source: parent,
          sourceHandle: `out:${referenced}`,
          target: table.id,
          targetHandle: `in:${column}`,
          data: {
            oneToOne: unique,
            born: highlights.bornEdges.has(constraint.id),
            stamp: highlights.stamp,
            label: constraint.definition,
          },
        },
      ];
    }),
  );
}

function Canvas() {
  const current = useWorkspace((s) => s.snapshot);
  const viewing = useWorkspace((s) => s.viewing);
  // Time travel shows a past schema; the live one is what the database holds now.
  const snapshot = viewing?.snapshot ?? current;
  const positions = useWorkspace((s) => s.positions);
  const highlights = useWorkspace((s) => s.highlights);
  const setPositions = useWorkspace((s) => s.setPositions);
  // Full layouts are asynchronous; only the most recent one may apply its result.
  const generation = useRef(0);
  // Bumped by every full layout; remounting React Flow with it re-runs its own fitView,
  // which waits for the nodes to be measured.
  const [layoutVersion, setLayoutVersion] = useState(0);

  const layoutFully = useCallback(
    (target: SchemaSnapshot) => {
      const mine = ++generation.current;
      void layoutAll(target).then((all) => {
        if (mine !== generation.current) return;
        setPositions(all);
        setLayoutVersion((v) => v + 1);
      });
    },
    [setPositions],
  );

  // Place what has no position yet: a full layout when nothing is placed (first load),
  // otherwise only the new tables, leaving the user's arrangement alone.
  useEffect(() => {
    const unplaced = snapshot.tables.filter((t) => !positions[t.id]);
    if (unplaced.length === 0) return;
    if (unplaced.length === snapshot.tables.length) layoutFully(snapshot);
    else setPositions(placeNewTables(snapshot, positions));
  }, [snapshot, positions, setPositions, layoutFully]);

  const derived = useMemo(
    () => toNodes(snapshot, positions, highlights),
    [snapshot, positions, highlights],
  );
  const edges = useMemo(() => toEdges(snapshot, highlights), [snapshot, highlights]);

  // React Flow measures nodes and moves them while dragging; keep that in local state and
  // commit positions to the store when a drag ends.
  const [nodes, setNodes] = useState<TableNodeType[]>(derived);
  const [synced, setSynced] = useState(derived);
  if (synced !== derived) {
    // Synced during render, not in an effect: a React Flow remounted by a new layout must
    // see the new positions on its first render. Measurements are kept; React Flow
    // re-measures anything whose size changes.
    setSynced(derived);
    const measured = new Map(nodes.map((n) => [n.id, n.measured]));
    setNodes(
      derived.map((n) => {
        const size = measured.get(n.id);
        return size ? { ...n, measured: size } : n;
      }),
    );
  }

  const onNodesChange = useCallback(
    (changes: NodeChange<TableNodeType>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const relayout = useCallback(() => layoutFully(snapshot), [snapshot, layoutFully]);

  if (snapshot.tables.length === 0) return <EmptyCanvas />;

  const count = snapshot.tables.length;

  return (
    <div className="relative h-full w-full bg-canvas">
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
        <span className="glass flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium text-muted">
          <Database aria-hidden className="size-3.5 text-structure" />
          Schema
          <span className="font-normal text-faint">
            · {count} {count === 1 ? 'tabela' : 'tabelas'}
          </span>
        </span>
        <TimeTravelBanner />
      </div>
      <ReactFlow
        key={layoutVersion}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, node) => setPositions({ [node.id]: node.position })}
        nodesConnectable={false}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        aria-label="Diagrama do schema"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.2}
          color="var(--border-strong)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="glass absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-xl p-1">
        <button
          type="button"
          onClick={relayout}
          title="Recalcula a posição de todas as tabelas"
          className={buttonClass('ghost')}
        >
          <LayoutGrid aria-hidden />
          Reorganizar
        </button>
        <ExportMenu />
      </div>
      <SchemaAnnouncer />
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-canvas p-8">
      <div
        aria-hidden
        className="w-60 rounded-xl border border-dashed border-border-strong bg-surface-1/60 p-3"
      >
        <div className="mb-3 flex items-center gap-2">
          <div className="size-4 rounded bg-surface-3" />
          <div className="h-3 w-24 rounded bg-surface-3" />
        </div>
        {[0.75, 0.55, 0.65].map((width) => (
          <div key={width} className="mb-2 flex items-center gap-2 last:mb-0">
            <div className="h-2.5 rounded bg-surface-2" style={{ width: `${width * 100}%` }} />
            <div className="ml-auto h-2.5 w-6 rounded bg-surface-2" />
          </div>
        ))}
      </div>
      <p className="max-w-64 text-center text-[13px] text-muted">
        Execute um <code className="font-mono text-structure">CREATE TABLE</code> e ela aparece
        aqui.
      </p>
    </div>
  );
}

/** Screen readers hear what the last script did to the schema (DESIGN.md › Acessibilidade). */
function SchemaAnnouncer() {
  const runs = useWorkspace((s) => s.runs);
  const changes = runs.at(-1)?.result.schema?.changes ?? [];
  const text = changes
    .map((c) => {
      switch (c.type) {
        case 'table-created':
          return `Tabela ${c.table.name} criada`;
        case 'table-dropped':
          return `Tabela ${c.table.name} removida`;
        case 'column-added':
          return `Coluna ${c.column.name} adicionada a ${c.table.name}`;
        case 'constraint-added':
          return `Restrição ${c.constraint.name} criada em ${c.table.name}`;
        default:
          return null;
      }
    })
    .filter(Boolean)
    .join('. ');
  return (
    <p aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}

function TimeTravelBanner() {
  const viewing = useWorkspace((s) => s.viewing);
  const timeTravelTo = useWorkspace((s) => s.timeTravelTo);
  if (!viewing) return null;

  return (
    <div className="pointer-events-auto flex h-8 items-center gap-2 rounded-xl border border-sev-warning/40 bg-surface-1 px-2.5 text-[12px] text-sev-warning shadow-[var(--elevation-1)]">
      <History aria-hidden className="size-3.5" />
      <span>Vendo o schema de {new Date(viewing.at).toLocaleTimeString('pt-BR')}</span>
      <button
        type="button"
        onClick={() => timeTravelTo(null)}
        className="font-medium underline underline-offset-2"
      >
        voltar ao atual
      </button>
    </div>
  );
}

export function SchemaCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
