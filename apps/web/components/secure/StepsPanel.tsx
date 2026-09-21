'use client';

import type { Lab } from '@sqlscope/labs';
import { useState } from 'react';
import { useStore } from 'zustand';
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
    <div className="shrink-0 border-b border-border bg-surface-2/40 px-4 py-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[14px] font-semibold text-text">{lab.title}</h2>
        <span className="text-[12px] text-faint">
          {index < 0 ? 'introdução' : `passo ${index + 1} de ${lab.steps.length}`}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index < 0}
            className="rounded-md border border-border px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
          >
            ← Anterior
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index >= lab.steps.length - 1}
            className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-surface-0 hover:opacity-90 disabled:opacity-40"
          >
            {index < 0 ? 'Começar' : 'Próximo →'}
          </button>
        </div>
      </div>

      {step ? (
        <div className="mt-2 space-y-1.5 text-[13px]">
          <p className="font-medium text-text">{step.title}</p>
          <p className="text-muted">{step.brief}</p>
          <p className="text-[12px] text-faint">
            <span className="text-structure">O que observar: </span>
            {step.expect}
          </p>
        </div>
      ) : (
        <p className="mt-2 max-w-3xl text-[13px] text-muted">{lab.premise}</p>
      )}
    </div>
  );
}
