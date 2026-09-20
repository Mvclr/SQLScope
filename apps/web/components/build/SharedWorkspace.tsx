'use client';

import { useEffect, useRef, useState } from 'react';
import { decodeShare } from '../../lib/share';
import { pgliteBackend } from '../workspace/pglite-backend';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';
import { Workspace } from '../workspace/Workspace';

type Stage =
  | { name: 'reading' }
  | { name: 'replaying'; done: number; total: number }
  | { name: 'ready' }
  | { name: 'invalid' };

/** Waits for the workspace to finish opening, whatever the outcome. */
function whenSettled(store: WorkspaceStore): Promise<void> {
  const { status } = store.getState();
  if (status !== 'opening') return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      if (state.status === 'opening') return;
      unsubscribe();
      resolve();
    });
  });
}

/**
 * Opens a session someone shared: a fresh database in this browser, with the SQL of the
 * original session replayed into it. Nothing was uploaded — the statements travelled in
 * the link itself.
 */
export function SharedWorkspace() {
  const [store] = useState(() => createWorkspaceStore(pgliteBackend(), ''));
  const [stage, setStage] = useState<Stage>({ name: 'reading' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const session = await decodeShare(window.location.hash.slice(1));
      if (!session || session.scripts.length === 0) return setStage({ name: 'invalid' });

      store.getState().attach();
      await whenSettled(store);
      if (store.getState().status !== 'ready') return setStage({ name: 'invalid' });

      for (const [index, script] of session.scripts.entries()) {
        setStage({ name: 'replaying', done: index, total: session.scripts.length });
        await store.getState().run(script);
      }
      store.getState().setSql(session.scripts.at(-1) ?? '');
      setStage({ name: 'ready' });
    })();
  }, [store]);

  if (stage.name === 'invalid') {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-[18px] font-semibold">Link inválido</h1>
        <p className="mt-2 text-muted">
          Este link não contém uma sessão que possamos abrir. Ele pode ter sido cortado ao ser
          copiado.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <p className="shrink-0 border-b border-border bg-surface-2/50 px-4 py-2 text-[12px] text-muted">
        {stage.name === 'ready'
          ? 'Sessão compartilhada, reconstruída no seu navegador. Ela é sua: execute o que quiser.'
          : stage.name === 'replaying'
            ? `Reexecutando a sessão… (${stage.done + 1} de ${stage.total})`
            : 'Lendo o link…'}
      </p>
      <div className="min-h-0 flex-1">
        <Workspace store={store} openingLabel="Carregando PostgreSQL no seu navegador…" />
      </div>
    </div>
  );
}
