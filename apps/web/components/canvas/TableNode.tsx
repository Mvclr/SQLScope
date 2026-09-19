'use client';

import type { TableSnapshot } from '@sqlscope/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { NODE_WIDTH } from './layout';

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
  PK: 'text-accent border-accent/40',
  FK: 'text-structure border-structure/40',
  UQ: 'text-sev-info border-sev-info/40',
  NN: 'text-muted border-border',
  IDX: 'text-perf-gain border-perf-gain/40',
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
      className={`rounded-lg border border-border bg-surface-1 shadow-lg shadow-black/20 ${born ? 'table-born' : ''} ${changed && !born ? 'delta-halo' : ''}`}
      style={{ width: NODE_WIDTH }}
    >
      <header className="flex items-center gap-2 rounded-t-lg border-b border-border bg-structure-soft px-3 py-2">
        <span className="truncate font-mono text-[13px] font-semibold text-text">
          {table.schema !== 'public' && <span className="text-muted">{table.schema}.</span>}
          {table.name}
        </span>
        {table.rowSecurity.enabled && (
          <span
            title="Row-Level Security ativo"
            className="ml-auto rounded border border-sev-warning/50 px-1 font-mono text-[10px] text-sev-warning"
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
              className={`relative flex h-[26px] items-center gap-2 px-3 text-[12px] ${columnClass}`}
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
                    className={`rounded border px-1 font-mono text-[10px] leading-4 ${badgeStyle[badge]}`}
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
