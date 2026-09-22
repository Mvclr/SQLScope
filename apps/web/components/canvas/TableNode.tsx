'use client';

import type { TableSnapshot } from '@sqlscope/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Table2 } from 'lucide-react';
import { memo } from 'react';
import { HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT } from './layout';

export interface TableNodeData extends Record<string, unknown> {
  table: TableSnapshot;
  stamp: number;
  born: boolean;
  changed: boolean;
  bornColumns: ReadonlySet<string>;
  changedColumns: ReadonlySet<string>;
}

export type TableNodeType = Node<TableNodeData, 'table'>;

type Badge = 'PK' | 'FK' | 'UQ' | 'NN' | 'IDX';

const badgeStyle: Record<Badge, string> = {
  PK: 'bg-accent/12 text-accent',
  FK: 'bg-structure/12 text-structure',
  UQ: 'bg-sev-info/12 text-sev-info',
  NN: 'bg-surface-3 text-muted',
  IDX: 'bg-perf-gain/12 text-perf-gain',
};

const badgeTitle: Record<Badge, string> = {
  PK: 'Chave primária',
  FK: 'Chave estrangeira',
  UQ: 'Único',
  NN: 'Não nulo',
  IDX: 'Indexado',
};

function badgesOf(table: TableSnapshot): Map<string, Badge[]> {
  const badges = new Map<string, Badge[]>();
  const add = (column: string | undefined, badge: Badge) => {
    if (!column) return;
    const list = badges.get(column) ?? [];
    if (!list.includes(badge)) list.push(badge);
    badges.set(column, list);
  };
  for (const c of table.constraints) {
    if (c.kind === 'primary key') c.columns.forEach((col) => add(col, 'PK'));
    if (c.kind === 'foreign key') c.columns.forEach((col) => add(col, 'FK'));
    if (c.kind === 'unique' && c.columns.length === 1) add(c.columns[0], 'UQ');
  }
  // An index helps queries filtering on its leading column.
  for (const index of table.indexes) if (!index.constraint) add(index.columns[0], 'IDX');
  for (const column of table.columns) {
    const isKey = badges.get(column.name)?.includes('PK');
    if (!column.nullable && !isKey) add(column.name, 'NN');
  }
  return badges;
}

function TableNodeView({ data }: NodeProps<TableNodeType>) {
  const { table, born, changed, stamp, bornColumns, changedColumns } = data;
  const badges = badgesOf(table);

  return (
    <div
      // Remounting on a new stamp restarts the halo animation.
      key={changed || born ? stamp : 'steady'}
      className={`rounded-xl border border-border bg-surface-1 shadow-[var(--elevation-2)] ${born ? 'table-born' : ''} ${changed && !born ? 'delta-halo' : ''}`}
      style={{ width: NODE_WIDTH }}
    >
      <header
        className="flex items-center gap-2 rounded-t-xl border-b border-border bg-structure-soft px-3"
        style={{ height: HEADER_HEIGHT }}
      >
        <Table2 aria-hidden className="size-3.5 shrink-0 text-structure" />
        <span className="truncate font-mono text-[13px] font-semibold text-text">
          {table.schema !== 'public' && <span className="text-muted">{table.schema}.</span>}
          {table.name}
        </span>
        {table.rowSecurity.enabled && (
          <span
            title="Row-Level Security ativo"
            className="ml-auto rounded-md bg-sev-warning/15 px-1.5 font-mono text-[10px] leading-4 text-sev-warning"
          >
            RLS
          </span>
        )}
      </header>
      <ul className="py-1">
        {table.columns.map((column) => {
          const key = `${table.id}:${column.name}`;
          const columnClass = bornColumns.has(key)
            ? 'column-born column-halo'
            : changedColumns.has(key)
              ? 'column-halo'
              : '';
          return (
            <li
              key={column.position}
              className={`relative flex items-center gap-2 px-3 text-[12px] hover:bg-surface-2 ${columnClass}`}
              style={{ height: ROW_HEIGHT }}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`in:${column.name}`}
                className="!h-2 !w-2 !border-0 !bg-transparent"
              />
              <span className="truncate font-mono text-text">{column.name}</span>
              <span className="truncate font-mono text-faint" title={column.dataType}>
                {column.dataType}
              </span>
              <span className="ml-auto flex shrink-0 gap-1">
                {(badges.get(column.name) ?? []).map((badge) => (
                  <span
                    key={badge}
                    title={badgeTitle[badge]}
                    className={`rounded-md px-1 font-mono text-[10px] leading-4 ${badgeStyle[badge]}`}
                  >
                    {badge}
                  </span>
                ))}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={`out:${column.name}`}
                className="!h-2 !w-2 !border-0 !bg-transparent"
              />
            </li>
          );
        })}
        {table.columns.length === 0 && (
          <li className="px-3 py-1 text-[12px] italic text-faint">sem colunas</li>
        )}
      </ul>
    </div>
  );
}

export const TableNode = memo(TableNodeView);
