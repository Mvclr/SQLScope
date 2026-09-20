'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SchemaCanvas } from '../canvas/SchemaCanvas';
import { SplitPane } from '../ui/SplitPane';
import { useWorkspace, WorkspaceProvider } from './context';
import { HistoryPanel } from './HistoryPanel';
import { PlanPanel } from './PlanPanel';
import { ReportPanel } from './ReportPanel';
import { ResultsPanel } from './ResultsPanel';
import { SqlEditor, type EditorMarker } from './SqlEditor';
import type { WorkspaceStore } from './store';

interface WorkspaceTab {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

interface WorkspaceProps {
  store: WorkspaceStore;
  /** Always-visible panel above the editor (e.g. the current challenge). */
  aboveEditor?: ReactNode;
  /** Controls shown in the toolbar after the Run button. */
  actions?: ReactNode;
  /** What is being prepared while the database opens. */
  openingLabel: string;
}

export function Workspace({ store, ...props }: WorkspaceProps) {
  useEffect(() => {
    store.getState().attach();
    return () => store.getState().detach();
  }, [store]);

  return (
    <WorkspaceProvider store={store}>
      <Layout {...props} />
    </WorkspaceProvider>
  );
}

function Layout({ aboveEditor, actions, openingLabel }: Omit<WorkspaceProps, 'store'>) {
  const status = useWorkspace((s) => s.status);
  const problem = useWorkspace((s) => s.problem);
  const reset = useWorkspace((s) => s.reset);

  const tabs: WorkspaceTab[] = [
    { id: 'results', label: 'Resultados', content: <ResultsPanel /> },
    { id: 'plan', label: 'Plano', content: <PlanPanel /> },
    { id: 'report', label: 'Análise', content: <ReportPanel /> },
    { id: 'history', label: 'Histórico', content: <HistoryPanel /> },
  ];

  return (
    <div className="relative h-full min-h-0">
      <SplitPane
        direction="horizontal"
        initial={0.5}
        storageKey="workspace"
        first={
          <SplitPane
            direction="vertical"
            initial={0.5}
            storageKey="editor"
            first={<EditorArea actions={actions} aboveEditor={aboveEditor} />}
            second={<BottomTabs tabs={tabs} />}
          />
        }
        second={
          <section aria-label="Schema" className="h-full bg-surface-0">
            <SchemaCanvas />
          </section>
        }
      />

      {status === 'opening' && (
        <Overlay>
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden />
          <p className="text-muted">{openingLabel}</p>
        </Overlay>
      )}
      {(status === 'failed' || status === 'ended') && (
        <Overlay>
          <p className="max-w-sm text-center text-text">{problem}</p>
          <button
            type="button"
            onClick={() => void reset()}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-surface-0 hover:opacity-90"
          >
            {status === 'ended' ? 'Abrir nova sessão' : 'Tentar de novo'}
          </button>
        </Overlay>
      )}
    </div>
  );
}

function EditorArea({ actions, aboveEditor }: { actions?: ReactNode; aboveEditor?: ReactNode }) {
  const sql = useWorkspace((s) => s.sql);
  const runs = useWorkspace((s) => s.runs);
  const status = useWorkspace((s) => s.status);
  const run = useWorkspace((s) => s.run);
  const notice = useWorkspace((s) => s.notice);
  const dismissNotice = useWorkspace((s) => s.dismissNotice);

  const markers = useMemo((): EditorMarker[] => {
    const last = runs.at(-1);
    // Positions refer to the text that ran; once the editor diverges they would point at
    // the wrong place.
    if (!last || last.sql !== sql) return [];
    const { syntaxError, statements } = last.result;
    if (syntaxError) return [{ start: syntaxError.position ?? 0, message: syntaxError.message }];
    const failed = statements.find((s) => s.status === 'error');
    if (failed?.status !== 'error') return [];
    return [{ start: failed.error.scriptPosition ?? failed.start, message: failed.error.message }];
  }, [runs, sql]);

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {aboveEditor}
      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-border bg-sev-warning/10 px-3 py-1.5 text-[12px] text-sev-warning"
        >
          <span>△ {notice}</span>
          <button
            type="button"
            onClick={dismissNotice}
            className="ml-auto text-muted hover:text-text"
            aria-label="Dispensar aviso"
          >
            ✕
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <SqlEditor markers={markers} />
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={status !== 'ready'}
          className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-surface-0 hover:opacity-90 disabled:opacity-50"
        >
          {status === 'running' ? 'Executando…' : '▶ Executar'}
          <kbd className="font-mono text-[11px] opacity-70">Ctrl+↵</kbd>
        </button>
        {actions}
      </div>
    </div>
  );
}

function BottomTabs({ tabs }: { tabs: readonly WorkspaceTab[] }) {
  const [active, setActive] = useState(tabs[0]!.id);
  const runs = useWorkspace((s) => s.runs.length);

  // A new run brings its results forward.
  useEffect(() => {
    if (runs > 0) setActive('results');
  }, [runs]);

  return (
    <div className="flex h-full flex-col bg-surface-1">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={tab.id === active}
            onClick={() => setActive(tab.id)}
            className={`border-b-2 px-3 py-2 text-[13px] ${tab.id === active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1">
        {tabs.find((t) => t.id === active)?.content}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface-0/80 backdrop-blur-sm">
      {children}
    </div>
  );
}
