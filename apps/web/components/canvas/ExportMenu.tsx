'use client';

import { toDbml, toDdl } from '@sqlscope/core/export';
import { getNodesBounds, getViewportForBounds, useReactFlow } from '@xyflow/react';
import {
  ChevronDown,
  Download,
  FileCode2,
  ImageDown,
  LoaderCircle,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { buttonClass } from '../ui/button';
import { useWorkspace } from '../workspace/context';

const PNG_WIDTH = 1600;
const PNG_HEIGHT = 1000;

/** Long enough for any browser to have started reading the blob. */
const REVOKE_AFTER_MS = 30_000;

function download(name: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  // Some browsers ignore a click on a link that is not in the document, and revoking the
  // URL in the same tick can cancel the download that click just started.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/** Takes the schema out of SQLScope: as SQL, as a diagram file, or as a picture. */
export function ExportMenu() {
  const snapshot = useWorkspace((s) => s.snapshot);
  const { getNodes } = useReactFlow();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // A menu floating over the diagram closes like any other: Escape or a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
        backgroundColor: style.getPropertyValue('--canvas').trim(),
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

  const items: [string, LucideIcon, () => void][] = [
    ['SQL (DDL)', FileCode2, () => download('schema.sql', toDdl(snapshot), 'application/sql')],
    ['DBML (dbdiagram.io)', Network, () => download('schema.dbml', toDbml(snapshot), 'text/plain')],
    ['Imagem (PNG)', ImageDown, () => void exportPng()],
  ];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={snapshot.tables.length === 0 || busy}
        className={buttonClass('ghost')}
      >
        {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}
        {busy ? 'Exportando…' : 'Exportar'}
        <ChevronDown
          aria-hidden
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul className="rise absolute right-0 top-full z-10 mt-2 w-56 rounded-xl border border-border bg-surface-1 p-1 shadow-[var(--elevation-2)]">
          {items.map(([label, Icon, action]) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => {
                  action();
                  if (!label.includes('PNG')) setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-text transition-colors hover:bg-surface-2"
              >
                <Icon aria-hidden className="size-3.5 text-faint" />
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
