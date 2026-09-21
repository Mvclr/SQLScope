'use client';

import { findLab, type Lab } from '@sqlscope/labs';
import { useState, type ReactNode } from 'react';
import { pgliteBackend } from '../workspace/pglite-backend';
import { createWorkspaceStore } from '../workspace/store';
import { Workspace, type WorkspaceTab } from '../workspace/Workspace';
import { AstPanel } from './AstPanel';
import { PoliciesPanel } from './PoliciesPanel';
import { PrivilegesPanel } from './PrivilegesPanel';
import { StepsPanel } from './StepsPanel';

const PANEL: Record<Lab['panel'], { label: string; content: (lab: Lab) => ReactNode }> = {
  ast: { label: 'Árvore', content: (lab) => <AstPanel baseline={lab.steps[0]!.sql} /> },
  privileges: { label: 'Privilégios', content: () => <PrivilegesPanel /> },
  policies: { label: 'Políticas', content: () => <PoliciesPanel /> },
};

/**
 * A lab runs on T0 and nowhere else: creating roles and policies needs a superuser, which
 * is exactly what a sandbox on a shared cluster must never hand out (ADR 0001). In the
 * browser the database is the learner's own, so the dangerous part is free.
 */
export function LabWorkspace({ labId }: { labId: string }) {
  const lab = findLab(labId) as Lab;
  const [store] = useState(() =>
    createWorkspaceStore(
      pgliteBackend({ schema: lab.setup, seed: '' }),
      `-- ${lab.title}\n-- Use "Começar" acima para carregar o primeiro passo.`,
    ),
  );

  const panel = PANEL[lab.panel];
  const tabs: WorkspaceTab[] = [{ id: 'lab', label: panel.label, content: panel.content(lab) }];

  return (
    <Workspace
      store={store}
      openingLabel="Carregando PostgreSQL no seu navegador…"
      aboveEditor={<StepsPanel lab={lab} store={store} />}
      extraTabs={tabs}
      actions={
        <button
          type="button"
          onClick={() => void store.getState().reset()}
          title="Descarta o banco e recomeça o lab do zero"
          className="ml-auto rounded-md border border-border px-2.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text"
        >
          Recomeçar o lab
        </button>
      }
    />
  );
}
