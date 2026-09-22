'use client';

import type { Lab } from '@sqlscope/labs';
import { ChevronLeft, ChevronRight, Eye, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { useStore } from 'zustand';
import { buttonClass } from '../ui/button';
import type { WorkspaceStore } from '../workspace/store';

/**
 * The lab's narrative, one step at a time.
 *
 * A step loads its SQL into the editor but never runs it: the learner presses Run, reads
 * the result, and decides when to move on. The SQL stays editable, because changing it and
 * seeing what happens is the exercise.
 */
export function StepsPanel({ lab, store }: { lab: Lab; store: WorkspaceStore }) {
  const [index, setIndex] = useState(-1);
  const setSql = useStore(store, (s) => s.setSql);
  const step = index >= 0 ? lab.steps[index] : undefined;

  const go = (next: number) => {
    setIndex(next);
    const target = lab.steps[next];
    if (target) setSql(target.sql);
  };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
          <FlaskConical aria-hidden className="size-3.5" />
        </span>
        <h2 className="min-w-0 text-[14px] font-semibold text-text">{lab.title}</h2>
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] tabular-nums text-muted">
          {index < 0 ? 'introdução' : `passo ${index + 1} de ${lab.steps.length}`}
        </span>
        <div className="ml-auto flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index < 0}
            className={buttonClass('secondary')}
          >
            <ChevronLeft aria-hidden />
            Anterior
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index >= lab.steps.length - 1}
            className={buttonClass('primary')}
          >
            {index < 0 ? 'Começar' : 'Próximo'}
            <ChevronRight aria-hidden />
          </button>
        </div>
      </div>

      {/* Where the learner is in the arc: one segment per step, filled as they go. */}
      <ol aria-hidden className="mt-3 flex gap-1">
        {lab.steps.map((_, i) => (
          <li
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= index ? 'bg-accent' : 'bg-surface-3'}`}
          />
        ))}
      </ol>

      {step ? (
        <div key={index} className="rise mt-3 space-y-1.5 text-[13px]">
          <p className="font-medium text-text">{step.title}</p>
          <p className="text-muted">{step.brief}</p>
          <p className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] text-muted">
            <Eye aria-hidden className="mt-0.5 size-3.5 shrink-0 text-structure" />
            <span>
              <span className="font-medium text-structure">O que observar: </span>
              {step.expect}
            </span>
          </p>
        </div>
      ) : (
        <p className="mt-3 max-w-3xl text-[13px] text-muted">{lab.premise}</p>
      )}
    </div>
  );
}
