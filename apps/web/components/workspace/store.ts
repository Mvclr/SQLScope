import type { DatabasePrivileges, SchemaChange, SchemaSnapshot, TableRef } from '@sqlscope/core';
import type { ScriptResult } from '@sqlscope/engine';
import type { Report } from '@sqlscope/security-rules';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { BackendError, type QueryAnalysisResult, type WorkspaceBackend } from './backend';

/** Something fetched on demand: a query analysis, a security report. */
export interface Loadable<T> {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly data: T | null;
  readonly error: string | null;
  /** The database changed after this was produced. */
  readonly stale: boolean;
}

const idle = <T>(): Loadable<T> => ({ status: 'idle', data: null, error: null, stale: false });

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
  analysis: Loadable<QueryAnalysisResult>;
  report: Loadable<Report>;
  /** Who may do what. Read on demand by the labs about privileges; T0 only. */
  privileges: Loadable<DatabasePrivileges>;
  /** A past moment being looked at, instead of the current schema. */
  viewing: {
    readonly runId: number;
    readonly at: number;
    readonly snapshot: SchemaSnapshot;
  } | null;

  /** Shows the schema as it was right after a run; `null` goes back to the present. */
  timeTravelTo(runId: number | null): void;
  analyzeQuery(sql?: string): Promise<void>;
  buildReport(): Promise<void>;
  /** Re-reads privileges from the database. Does nothing where the backend has none. */
  readPrivileges(): Promise<void>;
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
  // Ticket of the newest request of each kind; older answers are dropped (see `load`).
  const latest = { analysis: 0, report: 0, privileges: 0 };

  return createStore<WorkspaceState>()((set, get) => {
    const applySchema = (snapshot: SchemaSnapshot, changes: readonly SchemaChange[]) =>
      set((state) => ({
        snapshot,
        highlights: highlightsFor(changes, snapshot, state.highlights.stamp + 1),
        // A schema change can invalidate both: say so instead of showing old answers.
        report: { ...state.report, stale: state.report.data !== null },
        analysis: { ...state.analysis, stale: state.analysis.data !== null },
      }));

    /**
     * Runs one on-demand request, keeping its slice honest about what it holds.
     *
     * Only the newest request of each kind may write: analysing, editing the SQL and
     * analysing again leaves two in flight, and the slower one would otherwise land last
     * and show the plan of a query that is no longer on screen.
     */
    const load = async <T>(
      key: 'analysis' | 'report' | 'privileges',
      request: () => Promise<T>,
    ): Promise<void> => {
      const ticket = (latest[key] += 1);
      set({ [key]: { status: 'loading', data: get()[key].data, error: null, stale: false } });
      try {
        const data = await request();
        if (ticket !== latest[key]) return;
        set({ [key]: { status: 'ready', data, error: null, stale: false } });
      } catch (error) {
        if (ticket !== latest[key]) return;
        set({ [key]: { ...get()[key], status: 'error', error: describe(error) } });
      }
    };

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
      analysis: idle(),
      report: idle(),
      privileges: idle(),
      viewing: null,

      timeTravelTo(runId) {
        if (runId === null) return set({ viewing: null });
        const runs = get().runs;
        const index = runs.findIndex((run) => run.id === runId);
        if (index < 0) return;
        // The schema of that moment is the last one captured up to that run.
        const snapshot = runs
          .slice(0, index + 1)
          .reverse()
          .find((run) => run.result.schema)?.result.schema?.snapshot;
        set({ viewing: { runId, at: runs[index]!.at, snapshot: snapshot ?? { tables: [] } } });
      },

      async analyzeQuery(sql) {
        const target = (sql ?? get().sql).trim();
        if (target === '' || get().status !== 'ready') return;
        await load('analysis', () => backend.analyze(target));
      },

      buildReport() {
        return get().status === 'ready'
          ? load('report', () => backend.report())
          : Promise.resolve();
      },

      readPrivileges() {
        const read = backend.privileges;
        return read && get().status === 'ready'
          ? load('privileges', () => read.call(backend))
          : Promise.resolve();
      },

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
        set({
          runs: [],
          selectedRun: null,
          selectedStatement: 0,
          notice: null,
          analysis: idle(),
          report: idle(),
          privileges: idle(),
          // The runs it pointed at are gone, and so is the database they described.
          viewing: null,
        });
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
            // Running something brings the user back to the present.
            viewing: null,
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
