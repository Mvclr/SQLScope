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
      <div className="min-h-0 min-w-0" style={{ flexBasis: `${ratio * 100}%`, flexShrink: 0 }}>
        {first}
      </div>
      {/* The gap between two blocks is the handle: no line of its own, just a grip. */}
      <div
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(min * 100)}
        aria-valuemax={Math.round((1 - min) * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className={`group relative flex shrink-0 touch-none items-center justify-center rounded-full outline-offset-0 ${horizontal ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize'}`}
      >
        <span
          aria-hidden
          className={`rounded-full bg-border-strong transition-all duration-200 group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent ${horizontal ? 'h-8 w-[3px] group-hover:h-14' : 'h-[3px] w-8 group-hover:w-14'}`}
        />
      </div>
      <div className="min-h-0 min-w-0 flex-1">{second}</div>
    </div>
  );
}
