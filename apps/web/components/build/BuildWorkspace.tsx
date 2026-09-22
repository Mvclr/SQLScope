'use client';

import { Timer, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { readProject } from '../../lib/account';
import { buttonClass } from '../ui/button';
import { apiBackend, endSession, type SessionInfo } from '../workspace/api-backend';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';
import { Workspace } from '../workspace/Workspace';
import { SaveProjectButton } from './SaveProjectButton';

const starter = `-- Seu banco PostgreSQL 18, isolado e descartável.
-- Crie tabelas e veja o diagrama se formar ao lado. Ctrl+Enter executa.

create table users (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null unique
);

create table orders (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  total numeric(10, 2) not null check (total >= 0),
  created_at timestamptz not null default now()
);
`;

export function BuildWorkspace() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [store] = useState(() => createWorkspaceStore(apiBackend(setSession), starter));
  const projectId = useSearchParams().get('projeto');

  useProjectReplay(store, projectId);

  return (
    <Workspace
      store={store}
      openingLabel="Criando seu banco no servidor…"
      actions={
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SaveProjectButton store={store} />
          <SessionControls store={store} session={session} />
        </div>
      }
    />
  );
}

/** Reopening a project replays its statements into the session's sandbox. */
function useProjectReplay(store: WorkspaceStore, projectId: string | null) {
  const replayed = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId || replayed.current === projectId) return;
    replayed.current = projectId;

    void (async () => {
      const project = await readProject(projectId).catch(() => null);
      if (!project) return;
      await waitUntilReady(store);
      for (const script of project.scripts) await store.getState().run(script);
      store.getState().setSql(project.scripts.at(-1) ?? '');
    })();
  }, [store, projectId]);
}

function waitUntilReady(store: WorkspaceStore): Promise<void> {
  if (store.getState().status === 'ready') return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      if (state.status === 'opening') return;
      unsubscribe();
      resolve();
    });
  });
}

/** Idle countdown, reset by each run; the server enforces the real expiry. */
function SessionControls({
  store,
  session,
}: {
  store: WorkspaceStore;
  session: SessionInfo | null;
}) {
  const runs = useStore(store, (s) => s.runs.length);
  const status = useStore(store, (s) => s.status);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (session) setExpiresAt(new Date(session.idleExpiresAt).getTime());
  }, [session]);
  useEffect(() => {
    if (session && runs > 0) setExpiresAt(Date.now() + session.limits.idleMinutes * 60_000);
  }, [runs, session]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (!session || status === 'ended' || status === 'failed') return null;
  const seconds = Math.max(0, Math.round(((expiresAt ?? now) - now) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2 text-[12px] text-muted">
      <span
        className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-surface-2 px-2.5"
        title="Sem atividade por este tempo, o banco é descartado"
      >
        <Timer aria-hidden className="size-3.5 text-faint" />
        Expira em <span className="font-medium tabular-nums text-text">{clock}</span>
      </span>
      <button
        type="button"
        onClick={async () => {
          await endSession();
          await store.getState().reset();
        }}
        className={buttonClass('secondary')}
        title="Descarta o banco atual e cria outro vazio"
      >
        <Trash2 aria-hidden />
        Descartar e recomeçar
      </button>
    </div>
  );
}
