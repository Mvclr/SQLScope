'use client';

import type { PGliteInterface } from '@electric-sql/pglite';
import { pgliteSession } from '@sqlscope/core/pglite';
import type { Scenario } from '@sqlscope/scenarios';
import type { OpenVariant, Verdict } from '@sqlscope/scenarios/check';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createPGlite } from '../workspace/pglite-backend';
import type { WorkspaceStore } from '../workspace/store';

type Progress = Record<string, 'solved'>;

const progressKey = (scenario: Scenario) => `sqlscope:progress:${scenario.id}`;

function loadProgress(scenario: Scenario): Progress {
  try {
    return JSON.parse(localStorage.getItem(progressKey(scenario)) ?? '{}') as Progress;
  } catch {
    return {};
  }
}

/**
 * Answers are checked against fresh copies of every dataset variant — never the learner's
 * own database, which they are free to modify.
 */
function useVariantOpener(scenario: Scenario): OpenVariant {
  const template = useRef<Promise<PGliteInterface> | null>(null);
  useEffect(() => () => void template.current?.then((db) => db.close()), []);

  return async (variant) => {
    template.current ??= createPGlite().then(async (db) => {
      await db.exec(scenario.schema);
      return db;
    });
    const db = await (await template.current).clone();
    await db.exec(scenario.seed(variant));
    return { session: pgliteSession(db), close: () => db.close() };
  };
}

export function ChallengePanel({ scenario, store }: { scenario: Scenario; store: WorkspaceStore }) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState<Progress>({});
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const sql = useStore(store, (s) => s.sql);
  const open = useVariantOpener(scenario);

  useEffect(() => setProgress(loadProgress(scenario)), [scenario]);

  const challenge = scenario.challenges[index]!;
  const solvedCount = Object.keys(progress).length;

  const go = (next: number) => {
    setIndex(next);
    setVerdict(null);
    setShowHint(false);
  };

  const check = async () => {
    setChecking(true);
    setVerdict(null);
    try {
      const { checkAnswer } = await import('@sqlscope/scenarios/check');
      const result = await checkAnswer(challenge, sql, open);
      setVerdict(result);
      if (result.status === 'correct') {
        const next = { ...progress, [challenge.id]: 'solved' as const };
        setProgress(next);
        try {
          localStorage.setItem(progressKey(scenario), JSON.stringify(next));
        } catch {
          // Progress is a convenience; without storage it simply is not remembered.
        }
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <section
      aria-label="Desafio"
      className="shrink-0 border-b border-border bg-surface-2/40 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span className="font-medium text-text">{scenario.title}</span>
        <span>·</span>
        <span>
          {solvedCount}/{scenario.challenges.length} resolvidos
        </span>
        <nav aria-label="Desafios" className="ml-auto flex gap-1">
          {scenario.challenges.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => go(i)}
              aria-current={i === index}
              aria-label={`Desafio ${i + 1}: ${c.title}${progress[c.id] ? ' (resolvido)' : ''}`}
              className={`h-6 w-6 rounded font-mono text-[11px] ${
                i === index
                  ? 'bg-accent text-surface-0'
                  : progress[c.id]
                    ? 'border border-perf-gain/50 text-perf-gain'
                    : 'border border-border text-muted hover:text-text'
              }`}
            >
              {progress[c.id] && i !== index ? '✓' : i + 1}
            </button>
          ))}
        </nav>
      </div>

      <h2 className="mt-2 text-[14px] font-semibold">{challenge.title}</h2>
      <p className="mt-1 text-[13px] text-text">{challenge.prompt}</p>
      {challenge.ordered && (
        <p className="mt-1 text-[12px] text-faint">A ordem das linhas faz parte da resposta.</p>
      )}
      {showHint && challenge.hint && (
        <p className="mt-1 text-[12px] text-sev-info">Dica: {challenge.hint}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="rounded-md border border-accent px-2.5 py-1 text-[12px] text-accent hover:bg-accent hover:text-surface-0 disabled:opacity-50"
        >
          {checking ? 'Verificando…' : 'Verificar resposta'}
        </button>
        {challenge.hint && !showHint && (
          <button
            type="button"
            onClick={() => setShowHint(true)}
            className="text-[12px] text-muted hover:text-text"
          >
            Mostrar dica
          </button>
        )}
        {verdict && <VerdictLine verdict={verdict} />}
      </div>
    </section>
  );
}

function VerdictLine({ verdict }: { verdict: Verdict }) {
  if (verdict.status === 'correct') {
    return (
      <p role="status" className="text-[12px] text-perf-gain">
        ✓ Correto — a consulta dá a resposta certa em todas as variantes dos dados.
      </p>
    );
  }
  const where =
    verdict.status === 'incorrect' && verdict.variant > 0
      ? ' (em outra variante dos dados — a consulta precisa calcular, não fixar valores)'
      : '';
  return (
    <p
      role="status"
      className={`text-[12px] ${verdict.status === 'invalid' ? 'text-sev-warning' : 'text-sev-critical'}`}
    >
      {verdict.status === 'invalid' ? '△' : '✕'} {verdict.message}
      {where}
    </p>
  );
}
