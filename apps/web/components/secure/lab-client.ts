import type { ScriptResult } from '@sqlscope/engine';
import type { BuiltQuery, SearchMode } from '@sqlscope/labs';
import { BackendError, type SessionNotice } from '../workspace/backend';

/** What the API tells the browser about its run. The sandbox credentials never appear. */
export interface LabRunView {
  readonly status: 'PENDING' | 'PROVISIONING' | 'READY' | 'ACTIVE';
  readonly queuePosition: number | null;
  readonly expiresAt: string | null;
  readonly idleExpiresAt: string | null;
}

/** The mini-app's answer: what the app built, and what the database did with it. */
export interface AppOutcome extends BuiltQuery {
  readonly result:
    | { readonly ok: true; readonly columns: string[]; readonly rows: (string | null)[][] }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (response.ok) return (await response.json().catch(() => ({}))) as T;

  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (response.status === 401) {
    throw new BackendError('Sua sessão expirou. Recarregue a página.', 'session-ended');
  }
  if (response.status === 429) {
    throw new BackendError(
      body.message ?? 'Muitas requisições. Aguarde um instante.',
      'rate-limited',
    );
  }
  throw new BackendError(
    body.message ?? 'O laboratório no servidor está indisponível agora.',
    'unavailable',
  );
}

/**
 * The browser's side of a T2 lab (ADR 0010). A lab run rides on the ordinary session, so it
 * reuses the session cookie and the session's SSE stream; the queue, the ready sandbox and
 * the end all arrive there as notices.
 */
export function labClient(labId: string) {
  let events: EventSource | undefined;

  return {
    /** Ensures a session exists, then starts (or rejoins) the lab. */
    async start(): Promise<LabRunView> {
      await call('/sessions', { method: 'POST' });
      return call<LabRunView>(`/labs/${encodeURIComponent(labId)}/runs`, { method: 'POST' });
    },

    /** Claims the sandbox once it is READY (the first heartbeat). */
    claim() {
      return call<LabRunView>('/labs/runs/current/claim', { method: 'POST' });
    },

    /** Runs one search through the mini-app. */
    runApp(input: string, mode: SearchMode) {
      return call<AppOutcome>('/labs/runs/current/app', {
        method: 'POST',
        body: JSON.stringify({ input, mode }),
      });
    },

    /** Runs the learner's own SQL on the sandbox. */
    runConsole(sql: string) {
      return call<ScriptResult>('/labs/runs/current/execute', {
        method: 'POST',
        body: JSON.stringify({ sql }),
      });
    },

    subscribe(listener: (notice: SessionNotice) => void): () => void {
      events ??= new EventSource('/api/sessions/current/events');
      const types: SessionNotice['type'][] = [
        'lab-queued',
        'lab-ready',
        'lab-ended',
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

    /** Releases the lab and closes the stream. Best effort: called on unmount. */
    async close(): Promise<void> {
      events?.close();
      events = undefined;
      await fetch('/api/labs/runs/current', { method: 'DELETE', credentials: 'same-origin' }).catch(
        () => undefined,
      );
    },
  };
}
