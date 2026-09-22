'use client';

import {
  CircleAlert,
  Gauge,
  History,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  Table2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SchemaCanvas } from '../canvas/SchemaCanvas';
import { buttonClass } from '../ui/button';
import { SplitPane } from '../ui/SplitPane';
import { useSlidingIndicator } from '../ui/useSlidingIndicator';
import { useWorkspace, WorkspaceProvider } from './context';
import { HistoryPanel } from './HistoryPanel';
import { PlanPanel } from './PlanPanel';
import { ReportPanel } from './ReportPanel';
import { ResultsPanel } from './ResultsPanel';
import { SqlEditor, type EditorMarker } from './SqlEditor';
import type { WorkspaceStore } from './store';

export interface WorkspaceTab {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly content: ReactNode;
}

interface WorkspaceProps {
  store: WorkspaceStore;
  /** Always-visible block above the editor (e.g. the current challenge). */
  aboveEditor?: ReactNode;
  /** Controls shown in the editor's toolbar, after the Run button. */
  actions?: ReactNode;
  /** Panels a mode adds to the bottom tabs, before the built-in ones (labs use this). */
  extraTabs?: readonly WorkspaceTab[];
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

/**
 * Three compartments (docs/DESIGN.md › Layout): the editor, what came back, and the
 * schema. The gaps between them are the resize handles.
 */
function Layout({ aboveEditor, actions, extraTabs, openingLabel }: Omit<WorkspaceProps, 'store'>) {
  const status = useWorkspace((s) => s.status);
  const problem = useWorkspace((s) => s.problem);
  const reset = useWorkspace((s) => s.reset);

  const tabs: WorkspaceTab[] = [
    ...(extraTabs ?? []),
    { id: 'results', label: 'Resultados', icon: Table2, content: <ResultsPanel /> },
    { id: 'plan', label: 'Plano', icon: Gauge, content: <PlanPanel /> },
    { id: 'report', label: 'Análise', icon: ShieldCheck, content: <ReportPanel /> },
    { id: 'history', label: 'Histórico', icon: History, content: <HistoryPanel /> },
  ];

  return (
    <div className="relative h-full min-h-0 px-2 pb-2">
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
          <section aria-label="Schema" className="bento h-full overflow-hidden">
            <SchemaCanvas />
          </section>
        }
      />

      {status === 'opening' && (
        <Overlay>
          <LoaderCircle aria-hidden className="size-6 animate-spin text-accent" />
          <p className="text-muted">{openingLabel}</p>
        </Overlay>
      )}
      {(status === 'failed' || status === 'ended') && (
        <Overlay>
          <CircleAlert aria-hidden className="size-6 text-sev-warning" />
          <p className="text-text">{problem}</p>
          <button
            type="button"
            onClick={() => void reset()}
            className={buttonClass('primary', 'md')}
          >
            <RotateCcw aria-hidden />
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
    <div className="flex h-full min-h-0 flex-col gap-2">
      {aboveEditor && <div className="bento shrink-0 overflow-hidden">{aboveEditor}</div>}
      <div className="bento flex min-h-0 flex-1 flex-col overflow-hidden">
        {notice && (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-sev-warning/25 bg-sev-warning/10 px-3 py-1.5 text-[12px] text-sev-warning"
          >
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            <span>{notice}</span>
            <button
              type="button"
              onClick={dismissNotice}
              className="ml-auto grid size-5 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
              aria-label="Dispensar aviso"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <SqlEditor markers={markers} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2.5 py-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={status !== 'ready'}
            className={buttonClass('primary', 'md')}
          >
            {status === 'running' ? (
              <LoaderCircle aria-hidden className="animate-spin" />
            ) : (
              <Play aria-hidden className="fill-current" />
            )}
            {status === 'running' ? 'Executando…' : 'Executar'}
            <kbd className="rounded bg-on-accent/15 px-1 font-mono text-[10px] font-normal">
              Ctrl ↵
            </kbd>
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}

function BottomTabs({ tabs }: { tabs: readonly WorkspaceTab[] }) {
  const [active, setActive] = useState(tabs[0]!.id);
  const runs = useWorkspace((s) => s.runs.length);
  const { ref, box } = useSlidingIndicator<HTMLDivElement>(active);

  // A new run brings its results forward — except in a lab, whose own panel is the point
  // of running anything at all.
  useEffect(() => {
    if (runs > 0) setActive((current) => (current === tabs[0]!.id ? current : 'results'));
  }, [runs, tabs]);

  return (
    <div className="bento flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border p-1.5">
        <div
          ref={ref}
          role="tablist"
          className="relative flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-surface-2 p-0.5"
        >
          {box && (
            <span
              aria-hidden
              className="absolute inset-y-0.5 rounded-lg bg-surface-raised shadow-sm transition-[left,width] duration-300 ease-[var(--ease-snappy)]"
              style={{ left: box.left, width: box.width }}
            />
          )}
          {tabs.map(({ id, label, icon: Icon }) => {
            const selected = id === active;
            return (
              <button
                key={id}
                role="tab"
                type="button"
                data-indicator={id}
                aria-selected={selected}
                onClick={() => setActive(id)}
                className={`relative flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${selected ? 'text-text' : 'text-muted hover:text-text'}`}
              >
                <Icon
                  aria-hidden
                  className={`size-3.5 transition-colors ${selected ? 'text-accent' : 'text-faint'}`}
                />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" className="min-h-0 flex-1">
        {tabs.find((t) => t.id === active)?.content}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-surface-0/60 backdrop-blur-[3px]">
      <div className="bento rise flex max-w-sm flex-col items-center gap-3 px-6 py-5 text-center">
        {children}
      </div>
    </div>
  );
}
