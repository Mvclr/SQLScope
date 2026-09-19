import type { SchemaChange, SchemaSnapshot } from '@sqlscope/core';
import { filter, map, Subject, type Observable } from 'rxjs';

/** Pushed to the browser over SSE (ADR 0005). */
export type SessionNotice =
  | {
      readonly type: 'schema-changed';
      readonly snapshot: SchemaSnapshot;
      readonly changes: readonly SchemaChange[];
    }
  | { readonly type: 'session-expiring'; readonly secondsLeft: number }
  | { readonly type: 'session-ended'; readonly reason: string };

/**
 * In-process fan-out of session notices. One API process holds every session's pinned
 * connection (see SessionConnections), so every notice originates here too.
 */
export class SessionEventBus {
  private readonly notices = new Subject<{ sessionId: string; notice: SessionNotice }>();

  publish(sessionId: string, notice: SessionNotice): void {
    this.notices.next({ sessionId, notice });
  }

  stream(sessionId: string): Observable<SessionNotice> {
    return this.notices.pipe(
      filter((n) => n.sessionId === sessionId),
      map((n) => n.notice),
    );
  }
}
