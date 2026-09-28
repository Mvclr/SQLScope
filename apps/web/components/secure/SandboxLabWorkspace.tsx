'use client';

import type { StatementOutput } from '@sqlscope/core';
import { buildSearch, findLab, type Lab, type LabStep, type SearchMode } from '@sqlscope/labs';
import {
  ChevronLeft,
  ChevronRight,
  CircleX,
  Eye,
  ListTree,
  Loader2,
  Search,
  Server,
  ShieldAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buttonClass } from '../ui/button';
import { ResultGrid } from '../workspace/ResultGrid';
import { BackendError } from '../workspace/backend';
import { AstPanel } from './AstPanel';
import { labClient, type AppOutcome, type LabRunView } from './lab-client';

type Phase = 'opening' | 'queued' | 'provisioning' | 'ready' | 'ended' | 'failed';

const inputClass =
  'h-10 w-full rounded-lg border border-border bg-surface-2 px-3 font-mono text-[13px] outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent/15';

/** The query shape the app intends: a plain search, for the tree to compare against. */
const BASELINE = buildSearch('cliente@exemplo.com', 'concatenated').text;

/**
 * The injection lab on a T2 sandbox (ADR 0010): a real PostgreSQL of the learner's own,
 * behind the API. The learner types in a search field and the mini-app builds the query —
 * the tree shows what the database received, and least privilege shows what it refused.
 *
 * The sandbox may be queued or take a moment to provision, so this waits on the session's
 * event stream before showing the app.
 */
export function SandboxLabWorkspace({ labId }: { labId: string }) {
  const lab = findLab(labId) as Lab;
  const client = useMemo(() => labClient(labId), [labId]);

  const [phase, setPhase] = useState<Phase>('opening');
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const claimed = useRef(false);

  const claim = useCallback(async () => {
    if (claimed.current) return;
    claimed.current = true;
    try {
      await client.claim();
      setPhase('ready');
    } catch (error) {
      claimed.current = false;
      setProblem(error instanceof BackendError ? error.message : 'Falha ao iniciar o laboratório.');
      setPhase('failed');
    }
  }, [client]);

  const advance = useCallback(
    (view: LabRunView) => {
      if (view.status === 'READY' || view.status === 'ACTIVE') void claim();
      else if (view.status === 'PENDING') {
        setQueuePosition(view.queuePosition);
        setPhase('queued');
      } else setPhase('provisioning');
    },
    [claim],
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = client.subscribe((notice) => {
      if (!active) return;
      if (notice.type === 'lab-queued') {
        setQueuePosition(notice.position);
        setPhase((p) => (p === 'ready' ? p : 'queued'));
      } else if (notice.type === 'lab-ready') void claim();
      else if (notice.type === 'lab-ended') {
        setProblem('O laboratório foi encerrado e o banco descartado.');
        setPhase('ended');
      } else if (notice.type === 'session-ended') {
        setProblem('Sua sessão foi encerrada.');
        setPhase('ended');
      }
    });

    client
      .start()
      .then((view) => active && advance(view))
      .catch((error: unknown) => {
        if (!active) return;
        setProblem(
          error instanceof BackendError ? error.message : 'Falha ao iniciar o laboratório.',
        );
        setPhase('failed');
      });

    return () => {
      active = false;
      unsubscribe();
      void client.close();
    };
  }, [client, advance, claim]);

  if (phase === 'ready') return <LabBench lab={lab} client={client} />;
  return <Waiting phase={phase} queuePosition={queuePosition} problem={problem} lab={lab} />;
}

/** The waiting, ended and failed screens — everything before the app is usable. */
function Waiting({
  phase,
  queuePosition,
  problem,
  lab,
}: {
  phase: Phase;
  queuePosition: number | null;
  problem: string | null;
  lab: Lab;
}) {
  const inQueue = phase === 'queued' && queuePosition !== null && queuePosition > 0;
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md text-center">
        {phase === 'ended' || phase === 'failed' ? (
          <ShieldAlert aria-hidden className="mx-auto size-8 text-sev-critical" />
        ) : (
          <Loader2 aria-hidden className="mx-auto size-8 animate-spin text-accent" />
        )}
        <h2 className="mt-3 text-[15px] font-semibold text-text">{lab.title}</h2>
        <p className="mt-1 text-[13px] text-muted">
          {phase === 'opening' && 'Pedindo um sandbox ao servidor…'}
          {phase === 'provisioning' && 'Subindo um PostgreSQL só seu, num container descartável…'}
          {inQueue && `Todos os sandboxes estão ocupados. Você é o ${queuePosition}º na fila.`}
          {phase === 'queued' && !inQueue && 'Na fila por um sandbox…'}
          {(phase === 'ended' || phase === 'failed') &&
            (problem ?? 'O laboratório não está disponível agora.')}
        </p>
        {(phase === 'ended' || phase === 'failed') && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={buttonClass('primary', 'md', 'mt-4')}
          >
            Tentar de novo
          </button>
        )}
      </div>
    </div>
  );
}

/** The usable lab: the narrative, the mini-app, the query it built, and the tree. */
function LabBench({ lab, client }: { lab: Lab; client: ReturnType<typeof labClient> }) {
  const [index, setIndex] = useState(-1);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<SearchMode>('concatenated');
  const [outcome, setOutcome] = useState<AppOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const step: LabStep | undefined = index >= 0 ? lab.steps[index] : undefined;

  const go = (next: number) => {
    const target = lab.steps[next];
    if (!target) return;
    setIndex(next);
    if (target.input !== undefined) setInput(target.input);
    if (target.mode !== undefined) setMode(target.mode);
  };

  const search = async () => {
    setRunning(true);
    setNotice(null);
    try {
      setOutcome(await client.runApp(input, mode));
    } catch (error) {
      setNotice(error instanceof BackendError ? error.message : 'Não foi possível buscar.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Steps lab={lab} index={index} step={step} onGo={go} />
      <div className="grid min-h-0 flex-1 gap-2 overflow-auto p-2 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col gap-2">
          <AppForm
            input={input}
            mode={mode}
            running={running}
            onInput={setInput}
            onMode={setMode}
            onSearch={() => void search()}
          />
          {notice && <p className="text-[12px] text-sev-critical">{notice}</p>}
          <BuiltQuery outcome={outcome} />
          <AppResult outcome={outcome} />
        </section>
        <section className="min-h-0 rounded-xl border border-border">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[12px] text-muted">
            <ListTree aria-hidden className="size-3.5 text-structure" />O que o banco recebeu
          </div>
          <div className="h-[calc(100%-2.5rem)]">
            <AstPanel sql={outcome?.text ?? ''} baseline={BASELINE} />
          </div>
        </section>
      </div>
    </div>
  );
}

function Steps({
  lab,
  index,
  step,
  onGo,
}: {
  lab: Lab;
  index: number;
  step: LabStep | undefined;
  onGo: (next: number) => void;
}) {
  return (
    <div className="shrink-0 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-6 place-items-center rounded-lg bg-accent/12 text-accent">
          <Server aria-hidden className="size-3.5" />
        </span>
        <h2 className="min-w-0 text-[14px] font-semibold text-text">{lab.title}</h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] tabular-nums text-muted">
          servidor · T2
        </span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => onGo(index - 1)}
            disabled={index < 0}
            className={buttonClass('secondary')}
          >
            <ChevronLeft aria-hidden />
            Anterior
          </button>
          <button
            type="button"
            onClick={() => onGo(index + 1)}
            disabled={index >= lab.steps.length - 1}
            className={buttonClass('primary')}
          >
            {index < 0 ? 'Começar' : 'Próximo'}
            <ChevronRight aria-hidden />
          </button>
        </div>
      </div>
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

function AppForm({
  input,
  mode,
  running,
  onInput,
  onMode,
  onSearch,
}: {
  input: string;
  mode: SearchMode;
  running: boolean;
  onInput: (value: string) => void;
  onMode: (mode: SearchMode) => void;
  onSearch: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
      className="rounded-xl border border-border bg-surface-2/40 p-3"
    >
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <Search aria-hidden className="size-3.5" />
        Buscar usuário por e-mail
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(event) => onInput(event.target.value)}
          placeholder="e-mail"
          spellCheck={false}
          className={inputClass}
        />
        <button type="submit" disabled={running} className={buttonClass('primary', 'md')}>
          {running ? <Loader2 aria-hidden className="animate-spin" /> : <Search aria-hidden />}
          Buscar
        </button>
      </div>
      {/* How the app turns the field into SQL — the whole point of the lab. */}
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-0.5 text-[12px]">
        {(['concatenated', 'parameterized'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onMode(value)}
            className={`h-7 rounded-md font-medium transition-colors ${
              mode === value
                ? 'bg-surface-raised text-text shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            {value === 'concatenated' ? 'App junta texto' : 'App usa parâmetro'}
          </button>
        ))}
      </div>
    </form>
  );
}

function BuiltQuery({ outcome }: { outcome: AppOutcome | null }) {
  if (!outcome) return null;
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3 text-[12px]">
      <div className="mb-1 font-medium text-muted">O que o app enviou ao banco</div>
      <code className="block whitespace-pre-wrap break-words font-mono text-[12px] text-text">
        {outcome.text}
      </code>
      {outcome.values.length > 0 && (
        <div className="mt-1.5 text-[12px] text-perf-gain">
          Valor, por fora da consulta: {outcome.values.map((v) => JSON.stringify(v)).join(', ')}
        </div>
      )}
    </div>
  );
}

function AppResult({ outcome }: { outcome: AppOutcome | null }) {
  if (!outcome) return null;
  if (!outcome.result.ok) {
    return (
      <p className="flex items-start gap-1.5 rounded-xl border border-sev-critical/35 bg-sev-critical/5 p-3 text-[12px] text-sev-critical">
        <CircleX aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>
          <span className="font-mono">{outcome.result.error.code}</span> —{' '}
          {outcome.result.error.message}
        </span>
      </p>
    );
  }
  const output: StatementOutput = {
    columns: outcome.result.columns.map((name) => ({ name, typeId: 25 })),
    rows: outcome.result.rows,
    command: 'SELECT',
    rowCount: outcome.result.rows.length,
    truncated: null,
  };
  return (
    <div className="min-h-0 flex-1 rounded-xl border border-border">
      <div className="border-b border-border px-3 py-1.5 text-[12px] text-muted">
        {outcome.result.rows.length} linha(s)
      </div>
      <div className="h-[calc(100%-2rem)] min-h-40">
        <ResultGrid output={output} />
      </div>
    </div>
  );
}
