'use client';

import { findScenario, type Scenario } from '@sqlscope/scenarios';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { buttonClass } from '../ui/button';
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
          className={buttonClass('secondary', 'sm', 'ml-auto')}
        >
          <RotateCcw aria-hidden />
          Restaurar dados
        </button>
      }
    />
  );
}
