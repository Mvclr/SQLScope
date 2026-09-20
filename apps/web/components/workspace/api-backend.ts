import type { SchemaSnapshot } from '@sqlscope/core';
import type { ScriptResult } from '@sqlscope/engine';
import type { Report } from '@sqlscope/security-rules';
import {
  BackendError,
  type QueryAnalysisResult,
  type SessionNotice,
  type WorkspaceBackend,
} from './backend';

export interface SessionInfo {
  id: string;
  idleExpiresAt: string;
  maxExpiresAt: string;
  snapshot: SchemaSnapshot;
  limits: { statementTimeoutMs: number; maxRows: number; idleMinutes: number };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (response.ok) return (await response.json()) as T;

  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (response.status === 401) {
    throw new BackendError('Sua sessão expirou. Abra uma nova para continuar.', 'session-ended');
  }
  if (response.status === 429) {
    throw new BackendError(
      body.message ?? 'Muitas requisições. Aguarde um instante.',
      'rate-limited',
    );
  }
  throw new BackendError(body.message ?? 'O servidor não respondeu como esperado.', 'unavailable');
}

/** T1: a sandbox database on the server, one per browser session (ADR 0001). */
export function apiBackend(onSession?: (info: SessionInfo) => void): WorkspaceBackend {
  let events: EventSource | undefined;

  return {
    tier: 'T1',
    async open() {
      const info = await call<SessionInfo>('/sessions', { method: 'POST' });
      onSession?.(info);
      return info.snapshot;
    },
    execute(sql) {
      return call<ScriptResult>('/sessions/current/execute', {
        method: 'POST',
        body: JSON.stringify({ sql }),
      });
    },
    analyze(sql) {
      return call<QueryAnalysisResult>('/sessions/current/analyze', {
        method: 'POST',
        body: JSON.stringify({ sql }),
      });
    },

    report() {
      return call<Report>('/sessions/current/report');
    },

    subscribe(listener) {
      events ??= new EventSource('/api/sessions/current/events');
      const types: SessionNotice['type'][] = [
        'schema-changed',
        'session-expiring',
        'session-ended',
      ];
      const handlers = types.map((type) => {
        const handler = (event: MessageEvent<string>) =>
          listener(JSON.parse(event.data) as SessionNotice);
        events!.addEventListener(type, handler);
        return [type, handler] as const;
      });
      return () =>
        handlers.forEach(([type, handler]) => events?.removeEventListener(type, handler));
    },
    async close() {
      events?.close();
      events = undefined;
    },
  };
}

export async function endSession(): Promise<void> {
  await fetch('/api/sessions/current', { method: 'DELETE', credentials: 'same-origin' });
}
