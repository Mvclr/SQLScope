import type { SchemaChange, SchemaSnapshot } from '@sqlscope/core';
import type { ScriptResult } from '@sqlscope/engine';

/** Pushed by the API over SSE. Mirrors apps/api/src/events/session-event-bus.ts. */
export type SessionNotice =
  | { type: 'schema-changed'; snapshot: SchemaSnapshot; changes: SchemaChange[] }
  | { type: 'session-expiring'; secondsLeft: number }
  | { type: 'session-ended'; reason: string };

/**
 * Where a workspace's SQL runs. The UI is identical for both tiers (ADR 0001): the same
 * engine produces the same `ScriptResult`, in the browser (T0) or behind the API (T1).
 */
export interface WorkspaceBackend {
  readonly tier: 'T0' | 'T1';
  /** Opens or resumes the database and returns its current schema. */
  open(): Promise<SchemaSnapshot>;
  execute(sql: string): Promise<ScriptResult>;
  /** Notices from the server; T0 has none. */
  subscribe?(listener: (notice: SessionNotice) => void): () => void;
  close(): Promise<void>;
}

/** Something the user should be told in words, not a stack trace. */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly kind: 'session-ended' | 'rate-limited' | 'unavailable',
  ) {
    super(message);
  }
}
