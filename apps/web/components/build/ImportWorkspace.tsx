'use client';

import { Eraser } from 'lucide-react';
import { useState } from 'react';
import { buttonClass } from '../ui/button';
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
          className={buttonClass('secondary', 'sm', 'ml-auto')}
        >
          <Eraser aria-hidden />
          Limpar banco
        </button>
      }
    />
  );
}
