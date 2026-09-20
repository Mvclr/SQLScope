'use client';

import { toDbml, toDdl } from '@sqlscope/core/export';
import { getNodesBounds, getViewportForBounds, useReactFlow } from '@xyflow/react';
import { useState } from 'react';
import { useWorkspace } from '../workspace/context';

const PNG_WIDTH = 1600;
const PNG_HEIGHT = 1000;

function download(name: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Takes the schema out of SQLScope: as SQL, as a diagram file, or as a picture. */
export function ExportMenu() {
  const snapshot = useWorkspace((s) => s.snapshot);
  const { getNodes } = useReactFlow();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const exportPng = async () => {
    setBusy(true);
    try {
      // React Flow only renders what is on screen; fit the whole graph into the image.
      const bounds = getNodesBounds(getNodes());
      const viewport = getViewportForBounds(bounds, PNG_WIDTH, PNG_HEIGHT, 0.2, 2, 0.1);
      const element = document.querySelector<HTMLElement>('.react-flow__viewport');
      if (!element) return;

      const { toPng } = await import('html-to-image');
      const style = getComputedStyle(document.documentElement);
      const dataUrl = await toPng(element, {
        backgroundColor: style.getPropertyValue('--surface-0').trim(),
        width: PNG_WIDTH,
        height: PNG_HEIGHT,
        style: {
          width: `${PNG_WIDTH}px`,
          height: `${PNG_HEIGHT}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = 'schema.png';
      link.click();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const items: [string, () => void][] = [
    ['SQL (DDL)', () => download('schema.sql', toDdl(snapshot), 'application/sql')],
    ['DBML (dbdiagram.io)', () => download('schema.dbml', toDbml(snapshot), 'text/plain')],
    ['Imagem (PNG)', () => void exportPng()],
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={snapshot.tables.length === 0 || busy}
        className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[12px] text-muted hover:bg-surface-3 hover:text-text disabled:opacity-50"
      >
        {busy ? 'Exportando…' : 'Exportar ▾'}
      </button>
      {open && (
        <ul className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-md border border-border bg-surface-1 shadow-lg">
          {items.map(([label, action]) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => {
                  action();
                  if (!label.includes('PNG')) setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-[12px] hover:bg-surface-2"
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
