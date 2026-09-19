'use client';

import { useState } from 'react';
import { pgliteBackend } from '../workspace/pglite-backend';
import { createWorkspaceStore } from '../workspace/store';
import { Workspace } from '../workspace/Workspace';

const starter = `-- Cole aqui o DDL do seu schema e execute (Ctrl+Enter).
-- Tudo roda no seu navegador: nada é enviado a um servidor.

create table users (
  id bigint generated always as identity primary key,
  email text not null unique
);

create table posts (
  id bigint generated always as identity primary key,
  author_id bigint not null references users (id),
  title text not null
);
`;

export function ImportWorkspace() {
  const [store] = useState(() => createWorkspaceStore(pgliteBackend(), starter));
  return (
    <Workspace
      store={store}
      openingLabel="Carregando PostgreSQL no seu navegador…"
      actions={
        <button
          type="button"
          onClick={() => void store.getState().reset()}
          className="ml-auto rounded-md border border-border px-2.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text"
        >
          Limpar banco
        </button>
      }
    />
  );
}
