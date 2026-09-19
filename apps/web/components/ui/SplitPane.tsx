'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface SplitPaneProps {
  direction: 'horizontal' | 'vertical';
  /** Share of the first pane, 0–1. */
  initial: number;
  /** Remembers the split per browser (DESIGN.md › Layout). */
  storageKey: string;
  min?: number;
  first: ReactNode;
  second: ReactNode;
}

function readStored(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return value > 0 && value < 1 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function SplitPane({
  direction,
  initial,
  storageKey,
  min = 0.15,
  first,
  second,
}: SplitPaneProps) {
  const [ratio, setRatio] = useState(initial);
  const container = useRef<HTMLDivElement>(null);
  const horizontal = direction === 'horizontal';

  useEffect(
    () => setRatio(readStored(`sqlscope:split:${storageKey}`, initial)),
    [storageKey, initial],
  );

  const commit = useCallback(
    (next: number) => {
      const clamped = Math.min(1 - min, Math.max(min, next));
      setRatio(clamped);
      try {
        localStorage.setItem(`sqlscope:split:${storageKey}`, String(clamped));
      } catch {
        // Storage may be unavailable (private mode); the split just is not remembered.
      }
    },
    [min, storageKey],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    const box = container.current?.getBoundingClientRect();
    if (!box) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) =>
      commit(horizontal ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (event.key === back) commit(ratio - step);
    if (event.key === forward) commit(ratio + step);
  };

  return (
    <div
      ref={container}
      className={`flex h-full min-h-0 w-full min-w-0 ${horizontal ? 'flex-row' : 'flex-col'}`}
    >
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexBasis: `${ratio * 100}%`, flexShrink: 0 }}
      >
        {first}
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(min * 100)}
        aria-valuemax={Math.round((1 - min) * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className={`shrink-0 bg-border transition-colors hover:bg-accent focus-visible:bg-accent ${horizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}`}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{second}</div>
    </div>
  );
}
