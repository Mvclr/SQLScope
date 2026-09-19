'use client';

import type { StatementOutput } from '@sqlscope/core';
import { typeCategory, typeName, type TypeCategory } from '@sqlscope/engine/display';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef } from 'react';

const ROW_HEIGHT = 28;
const CHAR_WIDTH = 7.4;

function Cell({ value, category }: { value: string | null; category: TypeCategory }) {
  if (value === null) return <span className="italic text-faint">NULL</span>;
  if (value === '') return <span className="text-faint">""</span>;
  const className =
    category === 'number'
      ? 'block text-right tabular-nums'
      : category === 'json' || category === 'array' || category === 'binary'
        ? 'text-structure'
        : category === 'boolean'
          ? 'text-accent'
          : '';
  return (
    <span className={className} title={value.length > 40 ? value : undefined}>
      {value}
    </span>
  );
}

/** Virtualised: only visible rows are in the DOM, however many came back. */
export function ResultGrid({ output }: { output: StatementOutput }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { columns, rows } = output;

  const template = useMemo(() => {
    const widths = columns.map((column, i) => {
      const longest = rows
        .slice(0, 200)
        .reduce((max, row) => Math.max(max, (row[i] ?? 'NULL').length), column.name.length + 2);
      return Math.min(360, Math.max(72, Math.round(longest * CHAR_WIDTH + 24)));
    });
    return `48px ${widths.map((w) => `${w}px`).join(' ')}`;
  }, [columns, rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const categories = columns.map((c) => typeCategory(c.typeId));

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto font-mono text-[12px]"
      role="table"
      aria-rowcount={rows.length}
    >
      <div className="w-max min-w-full">
        <div
          role="row"
          className="sticky top-0 z-10 grid border-b border-border bg-surface-2"
          style={{ gridTemplateColumns: template }}
        >
          <span className="px-2 py-1.5 text-right text-faint">#</span>
          {columns.map((column, i) => (
            <span
              key={i}
              role="columnheader"
              className={`truncate px-2 py-1.5 ${categories[i] === 'number' ? 'text-right' : ''}`}
              title={typeName(column.typeId)}
            >
              <span className="text-text">{column.name}</span>{' '}
              <span className="text-[10px] text-faint">{typeName(column.typeId)}</span>
            </span>
          ))}
        </div>
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              role="row"
              className="absolute left-0 grid w-full border-b border-border/50 hover:bg-surface-2"
              style={{
                gridTemplateColumns: template,
                height: ROW_HEIGHT,
                transform: `translateY(${item.start}px)`,
              }}
            >
              <span className="px-2 py-1 text-right text-faint tabular-nums">{item.index + 1}</span>
              {rows[item.index]!.map((value, i) => (
                <span key={i} role="cell" className="truncate px-2 py-1">
                  <Cell value={value} category={categories[i]!} />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
