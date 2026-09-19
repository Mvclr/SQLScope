'use client';

import { findScenario, type Scenario } from '@sqlscope/scenarios';
import { useState } from 'react';
import { pgliteBackend } from '../workspace/pglite-backend';
import { createWorkspaceStore } from '../workspace/store';
import { Workspace } from '../workspace/Workspace';
import { ChallengePanel } from './ChallengePanel';

export function LearnWorkspace({ scenarioId }: { scenarioId: string }) {
  // Resolved on the client: scenarios carry functions, which cannot cross from the server.
  const scenario = findScenario(scenarioId) as Scenario;
  const [store] = useState(() =>
    createWorkspaceStore(
      pgliteBackend({ schema: scenario.schema, seed: scenario.seed(0) }),
      scenario.starter,
    ),
  );

  return (
    <Workspace
      store={store}
      openingLabel="Carregando PostgreSQL no seu navegador…"
      aboveEditor={<ChallengePanel scenario={scenario} store={store} />}
      actions={
        <button
          type="button"
          onClick={() => void store.getState().reset()}
          title="Descarta suas alterações e restaura os dados originais do cenário"
          className="ml-auto rounded-md border border-border px-2.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text"
        >
          Restaurar dados
        </button>
      }
    />
  );
}
