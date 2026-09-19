import type { SchemaChange, SchemaSnapshot, TableRef } from '@sqlscope/core';
import type { ScriptResult } from '@sqlscope/engine';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { BackendError, type WorkspaceBackend } from './backend';

export interface Point {
  x: number;
  y: number;
}

export interface RunRecord {
  readonly id: number;
  readonly at: number;
  readonly sql: string;
  readonly result: ScriptResult;
}

/** What the last schema change touched, so the canvas can show it (DESIGN.md). */
export interface Highlights {
  /** Bumped on every change, so repeated animations restart. */
  readonly stamp: number;
  readonly bornTables: ReadonlySet<string>;
  readonly changedTables: ReadonlySet<string>;
  /** `tableId:column` */
  readonly bornColumns: ReadonlySet<string>;
  readonly changedColumns: ReadonlySet<string>;
  /** Foreign-key constraint ids. */
  readonly bornEdges: ReadonlySet<string>;
}

export type WorkspaceStatus = 'opening' | 'ready' | 'running' | 'failed' | 'ended';

export interface WorkspaceState {
  readonly tier: 'T0' | 'T1';
  status: WorkspaceStatus;
  /** Why the workspace is failed or ended, in the user's language. */
  problem: string | null;
  /** Transient message: rate limits, session about to expire. */
  notice: string | null;
  sql: string;
  snapshot: SchemaSnapshot;
  runs: RunRecord[];
  selectedRun: number | null;
  selectedStatement: number;
  highlights: Highlights;
  positions: Record<string, Point>;

  /** A view starts using the workspace: open it, or keep it open if it was just released. */
  attach(): void;
  /** A view stops using it. Closing is deferred, so an immediate re-attach reuses the database. */
  detach(): void;
  open(): Promise<void>;
  reset(): Promise<void>;
  run(sql?: string): Promise<void>;
  setSql(sql: string): void;
  selectRun(id: number): void;
  selectStatement(index: number): void;
  setPositions(positions: Record<string, Point>): void;
  dismissNotice(): void;
  close(): Promise<void>;
}

const noHighlights: Highlights = {
  stamp: 0,
  bornTables: new Set(),
  changedTables: new Set(),
  bornColumns: new Set(),
  changedColumns: new Set(),
  bornEdges: new Set(),
};

export type WorkspaceStore = StoreApi<WorkspaceState>;

export function createWorkspaceStore(
  backend: WorkspaceBackend,
  initialSql: string,
): WorkspaceStore {
  let unsubscribe: (() => void) | undefined;
  let nextRunId = 1;
  // open/close run strictly one after another. React may mount, unmount and remount a
  // workspace in quick succession; overlapping opens would provision two server sessions.
  let lifecycle: Promise<void> = Promise.resolve();
  const serial = (step: () => Promise<void>) => (lifecycle = lifecycle.then(step, step));
  // React mounts, unmounts and remounts components in development (StrictMode, Fast
  // Refresh). Tearing down and booting a whole PostgreSQL for that is wasteful, so a
  // detach only closes if no attach follows shortly.
  let attached = false;
  let pendingClose: ReturnType<typeof setTimeout> | undefined;

  return createStore<WorkspaceState>()((set, get) => {
    const applySchema = (snapshot: SchemaSnapshot, changes: readonly SchemaChange[]) =>
      set((state) => ({
        snapshot,
        highlights: highlightsFor(changes, snapshot, state.highlights.stamp + 1),
      }));

    return {
      tier: backend.tier,
      status: 'opening',
      problem: null,
      notice: null,
      sql: initialSql,
      snapshot: { tables: [] },
      runs: [],
      selectedRun: null,
      selectedStatement: 0,
      highlights: noHighlights,
      positions: {},

      attach() {
        clearTimeout(pendingClose);
        pendingClose = undefined;
        if (attached) return;
        attached = true;
        void get().open();
      },

      detach() {
        clearTimeout(pendingClose);
        pendingClose = setTimeout(() => {
          attached = false;
          void get().close();
        }, 250);
      },

      open: () =>
        serial(async () => {
          set({ status: 'opening', problem: null });
          try {
            const snapshot = await backend.open();
            set({ status: 'ready', snapshot, highlights: noHighlights, positions: {} });
            unsubscribe = backend.subscribe?.((notice) => {
              // The stream exists for other tabs; this tab already applied its own changes.
              if (
                notice.type === 'schema-changed' &&
                JSON.stringify(notice.snapshot) !== JSON.stringify(get().snapshot)
              ) {
                applySchema(notice.snapshot, notice.changes);
              }
              if (notice.type === 'session-expiring') {
                set({
                  notice: `Sua sessão expira em ${Math.ceil(notice.secondsLeft / 60)} min por inatividade.`,
                });
              }
              if (notice.type === 'session-ended') {
                set({ status: 'ended', problem: 'Sua sessão foi encerrada e o banco descartado.' });
              }
            });
          } catch (error) {
            set({ status: 'failed', problem: describe(error) });
          }
        }),

      async reset() {
        await get().close();
        set({ runs: [], selectedRun: null, selectedStatement: 0, notice: null });
        await get().open();
      },

      async run(sqlOverride) {
        const state = get();
        const sql = sqlOverride ?? state.sql;
        if (state.status !== 'ready' || sql.trim() === '') return;
        set({ status: 'running', notice: null });
        try {
          const result = await backend.execute(sql);
          const run: RunRecord = { id: nextRunId++, at: Date.now(), sql, result };
          set((s) => ({
            status: 'ready',
            runs: [...s.runs, run],
            selectedRun: run.id,
            selectedStatement: defaultStatement(result),
          }));
          if (result.schema) applySchema(result.schema.snapshot, result.schema.changes);
        } catch (error) {
          if (error instanceof BackendError && error.kind === 'session-ended') {
            set({ status: 'ended', problem: error.message });
          } else if (error instanceof BackendError) {
            set({ status: 'ready', notice: error.message });
          } else {
            set({ status: 'ready', notice: describe(error) });
          }
        }
      },

      setSql: (sql) => set({ sql }),
      selectRun: (id) => {
        const run = get().runs.find((r) => r.id === id);
        if (run) set({ selectedRun: id, selectedStatement: defaultStatement(run.result) });
      },
      selectStatement: (index) => set({ selectedStatement: index }),
      setPositions: (positions) => set((s) => ({ positions: { ...s.positions, ...positions } })),
      dismissNotice: () => set({ notice: null }),

      close: () =>
        serial(async () => {
          unsubscribe?.();
          unsubscribe = undefined;
          await backend.close();
        }),
    };
  });
}

/** The failed statement if any, else the last one that returned rows, else the last. */
function defaultStatement(result: ScriptResult): number {
  const statements = result.statements;
  const failed = statements.findIndex((s) => s.status === 'error');
  if (failed >= 0) return failed;
  for (let i = statements.length - 1; i >= 0; i--) {
    const s = statements[i]!;
    if (s.status === 'ok' && s.output.columns.length > 0) return i;
  }
  return Math.max(0, statements.length - 1);
}

function describe(error: unknown): string {
  if (error instanceof BackendError) return error.message;
  return error instanceof Error ? `Erro inesperado: ${error.message}` : 'Erro inesperado.';
}

export function highlightsFor(
  changes: readonly SchemaChange[],
  snapshot: SchemaSnapshot,
  stamp: number,
): Highlights {
  const bornTables = new Set<string>();
  const changedTables = new Set<string>();
  const bornColumns = new Set<string>();
  const changedColumns = new Set<string>();
  const bornEdges = new Set<string>();

  const idOf = (ref: TableRef) =>
    snapshot.tables.find((t) => t.schema === ref.schema && t.name === ref.name)?.id;

  for (const change of changes) {
    switch (change.type) {
      case 'table-created':
        bornTables.add(change.table.id);
        for (const c of change.table.constraints) if (c.kind === 'foreign key') bornEdges.add(c.id);
        break;
      case 'table-dropped':
        break;
      case 'table-renamed': {
        const id = idOf(change.to);
        if (id) changedTables.add(id);
        break;
      }
      default: {
        const id = idOf(change.table);
        if (!id) break;
        changedTables.add(id);
        if (change.type === 'column-added') bornColumns.add(`${id}:${change.column.name}`);
        if (change.type === 'column-renamed') changedColumns.add(`${id}:${change.to}`);
        if (change.type === 'column-altered') changedColumns.add(`${id}:${change.after.name}`);
        if (change.type === 'constraint-added') {
          for (const column of change.constraint.columns) changedColumns.add(`${id}:${column}`);
          if (change.constraint.kind === 'foreign key') bornEdges.add(change.constraint.id);
        }
      }
    }
  }
  return { stamp, bornTables, changedTables, bornColumns, changedColumns, bornEdges };
}
