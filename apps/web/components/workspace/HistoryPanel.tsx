'use client';

import { Check, History, LoaderCircle, Play, Share2, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { shareLink } from '../../lib/share';
import { buttonClass } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { useWorkspace } from './context';

const time = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Between replay steps: long enough to see a table appear, short enough to watch. */
const REPLAY_STEP_MS = 900;

/**
 * Everything run in this session, newest first. From here the user can go back to how the
 * schema looked at any point, watch it being built again, or share it as a link.
 */
export function HistoryPanel() {
  const runs = useWorkspace((s) => s.runs);
  const selectedRun = useWorkspace((s) => s.selectedRun);
  const viewing = useWorkspace((s) => s.viewing);
  const selectRun = useWorkspace((s) => s.selectRun);
  const setSql = useWorkspace((s) => s.setSql);
  const timeTravelTo = useWorkspace((s) => s.timeTravelTo);

  if (runs.length === 0) {
    return (
      <EmptyState icon={History}>
        Nada executado ainda. Cada execução fica aqui, com o schema daquele momento.
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <ol className="min-h-0 flex-1 space-y-0.5 overflow-auto p-1.5">
        {[...runs].reverse().map((run) => {
          const failed =
            run.result.syntaxError || run.result.statements.some((s) => s.status === 'error');
          const changes = run.result.schema?.changes.length ?? 0;
          return (
            <li
              key={run.id}
              className={`group rounded-lg transition-colors hover:bg-surface-2 ${run.id === selectedRun ? 'bg-surface-2' : ''}`}
            >
              <button
                type="button"
                onClick={() => selectRun(run.id)}
                className="w-full rounded-lg px-2.5 py-2 text-left"
              >
                <span className="flex items-center gap-2 text-[12px]">
                  <span className="tabular-nums text-faint">{time.format(run.at)}</span>
                  <span
                    className={`inline-flex items-center gap-1 ${failed ? 'text-sev-critical' : 'text-muted'}`}
                  >
                    {failed ? (
                      <X aria-hidden className="size-3.5" />
                    ) : (
                      <Check aria-hidden className="size-3.5" />
                    )}
                    {failed ? 'falhou' : `${run.result.statements.length} statement(s)`}
                  </span>
                  {changes > 0 && (
                    <span className="text-accent">· {changes} mudança(s) no schema</span>
                  )}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-faint">
                  {run.sql.trim().split('\n')[0]}
                </span>
              </button>
              <div className="flex gap-3 px-2.5 pb-2 text-[11px] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => setSql(run.sql)}
                  className="inline-flex items-center gap-1 text-structure hover:underline"
                >
                  <Undo2 aria-hidden className="size-3" />
                  Trazer de volta para o editor
                </button>
                <button
                  type="button"
                  onClick={() => timeTravelTo(viewing?.runId === run.id ? null : run.id)}
                  className="inline-flex items-center gap-1 text-structure hover:underline"
                >
                  <History aria-hidden className="size-3" />
                  {viewing?.runId === run.id
                    ? 'Voltar ao schema atual'
                    : 'Ver o schema deste momento'}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Toolbar() {
  const runs = useWorkspace((s) => s.runs);
  const timeTravelTo = useWorkspace((s) => s.timeTravelTo);
  const [replaying, setReplaying] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /** Steps through the session so the schema is built again, one run at a time. */
  const replay = async () => {
    setReplaying(true);
    try {
      for (const run of runs) {
        timeTravelTo(run.id);
        await new Promise((resolve) => setTimeout(resolve, REPLAY_STEP_MS));
      }
    } finally {
      timeTravelTo(null);
      setReplaying(false);
    }
  };

  const share = async () => {
    const scripts = runs.map((run) => run.sql);
    const url = await shareLink({ v: 1, scripts }, window.location.origin);
    if (!url) {
      setMessage('Esta sessão é longa demais para caber em um link.');
      return;
    }
    setLink(url);
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Link copiado.');
    } catch {
      setMessage('Copie o link abaixo.');
    }
  };

  return (
    <div className="shrink-0 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void replay()}
          disabled={replaying || runs.length === 0}
          className={buttonClass('secondary')}
        >
          {replaying ? <LoaderCircle aria-hidden className="animate-spin" /> : <Play aria-hidden />}
          {replaying ? 'Reproduzindo…' : 'Reproduzir a sessão'}
        </button>
        <button type="button" onClick={() => void share()} className={buttonClass('secondary')}>
          <Share2 aria-hidden />
          Compartilhar
        </button>
        {message && <span className="text-[12px] text-muted">{message}</span>}
      </div>
      {link && (
        <input
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          aria-label="Link da sessão"
          className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-muted"
        />
      )}
    </div>
  );
}
