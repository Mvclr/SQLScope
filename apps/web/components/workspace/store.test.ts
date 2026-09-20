import type { SchemaSnapshot } from '@sqlscope/core';
import type { ScriptResult } from '@sqlscope/engine';
import type { Report } from '@sqlscope/security-rules';
import { describe, expect, it, vi } from 'vitest';
import type { QueryAnalysisResult, WorkspaceBackend } from './backend';
import { createWorkspaceStore, type WorkspaceStore } from './store';

const table = (name: string): SchemaSnapshot['tables'][number] => ({
  id: name,
  schema: 'public',
  name,
  columns: [],
  constraints: [],
  indexes: [],
  rowSecurity: { enabled: false, forced: false },
});

const scriptResult = (snapshot: SchemaSnapshot | null): ScriptResult => ({
  syntaxError: null,
  statements: [],
  skipped: 0,
  schema: snapshot ? { snapshot, changes: [] } : null,
  schemaUnknown: false,
});

function fakeBackend(overrides: Partial<WorkspaceBackend> = {}): WorkspaceBackend {
  return {
    tier: 'T0',
    open: () => Promise.resolve({ tables: [] }),
    execute: () => Promise.resolve(scriptResult(null)),
    analyze: () => Promise.resolve({} as QueryAnalysisResult),
    report: () => Promise.resolve({} as Report),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

/** The store opens asynchronously; nothing else works until it is ready. */
async function opened(backend: WorkspaceBackend): Promise<WorkspaceStore> {
  const store = createWorkspaceStore(backend, 'select 1');
  await store.getState().open();
  return store;
}

describe('time travel', () => {
  it('shows the last schema captured up to the chosen run', async () => {
    const snapshots = [scriptResult({ tables: [table('users')] }), scriptResult(null)];
    const store = await opened(fakeBackend({ execute: () => Promise.resolve(snapshots.shift()!) }));

    await store.getState().run('create table users (id int)');
    await store.getState().run('select * from users');
    const [first, second] = store.getState().runs;
    store.getState().timeTravelTo(second!.id);

    // The second run changed nothing, so the moment it belongs to is the first one's schema.
    expect(store.getState().viewing?.snapshot.tables.map((t) => t.name)).toEqual(['users']);
    expect(store.getState().viewing?.runId).toBe(second!.id);
    expect(first!.id).not.toBe(second!.id);
  });

  it('returns to the present when the database is discarded', async () => {
    const store = await opened(fakeBackend({ execute: () => Promise.resolve(scriptResult(null)) }));
    await store.getState().run('select 1');
    store.getState().timeTravelTo(store.getState().runs[0]!.id);
    expect(store.getState().viewing).not.toBeNull();

    await store.getState().reset();

    // Otherwise the canvas keeps painting the schema of a database that no longer exists.
    expect(store.getState().viewing).toBeNull();
    expect(store.getState().runs).toEqual([]);
  });
});

describe('on-demand requests', () => {
  it('keeps the newest analysis when an older one answers last', async () => {
    const answers = new Map<string, () => void>();
    const store = await opened(
      fakeBackend({
        analyze: (sql) =>
          new Promise((resolve) =>
            answers.set(sql, () => resolve({ analysis: { sql }, previous: null } as never)),
          ),
      }),
    );

    const slow = store.getState().analyzeQuery('select 1');
    const fast = store.getState().analyzeQuery('select 2');
    answers.get('select 2')!();
    await fast;
    answers.get('select 1')!();
    await slow;

    const analysis = store.getState().analysis;
    expect((analysis.data?.analysis as { sql: string } | undefined)?.sql).toBe('select 2');
    expect(analysis.status).toBe('ready');
  });

  it('keeps the newest analysis when an older one fails last', async () => {
    const answers = new Map<string, (failure?: Error) => void>();
    const store = await opened(
      fakeBackend({
        analyze: (sql) =>
          new Promise((resolve, reject) =>
            answers.set(sql, (failure) =>
              failure ? reject(failure) : resolve({ analysis: { sql }, previous: null } as never),
            ),
          ),
      }),
    );

    const slow = store.getState().analyzeQuery('select 1');
    const fast = store.getState().analyzeQuery('select 2');
    answers.get('select 2')!();
    await fast;
    answers.get('select 1')!(new Error('tarde demais'));
    await slow;

    expect(store.getState().analysis.status).toBe('ready');
    expect(store.getState().analysis.error).toBeNull();
  });

  it('does not ask the backend before the database is ready', async () => {
    const analyze = vi.fn();
    const store = createWorkspaceStore(fakeBackend({ analyze }), 'select 1');

    await store.getState().analyzeQuery();

    expect(analyze).not.toHaveBeenCalled();
  });
});
