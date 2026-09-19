'use client';

import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { apiBackend, endSession, type SessionInfo } from '../workspace/api-backend';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';
import { Workspace } from '../workspace/Workspace';

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

  return (
    <Workspace
      store={store}
      openingLabel="Criando seu banco no servidor…"
      actions={<SessionControls store={store} session={session} />}
    />
  );
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
    <div className="ml-auto flex items-center gap-3 text-[12px] text-muted">
      <span title="Sem atividade por este tempo, o banco é descartado">
        Sessão expira em <span className="tabular-nums text-text">{clock}</span>
      </span>
      <button
        type="button"
        onClick={async () => {
          await endSession();
          await store.getState().reset();
        }}
        className="rounded-md border border-border px-2.5 py-1 hover:bg-surface-2 hover:text-text"
        title="Descarta o banco atual e cria outro vazio"
      >
        Descartar e recomeçar
      </button>
    </div>
  );
}
