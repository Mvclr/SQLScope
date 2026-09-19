import { Controller, type MessageEvent, Req, Sse, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { interval, map, merge, type Observable } from 'rxjs';
import { SessionGuard, sessionOf } from '../sessions/session.guard.js';
import { SessionEventBus } from './session-event-bus.js';

/** Proxies drop idle streams; a periodic event keeps the connection open. */
const HEARTBEAT_MS = 25_000;

@Controller('sessions/current')
export class EventsController {
  constructor(private readonly bus: SessionEventBus) {}

  @Sse('events')
  @UseGuards(SessionGuard)
  events(@Req() request: Request): Observable<MessageEvent> {
    const notices = this.bus
      .stream(sessionOf(request).id)
      .pipe(map((notice): MessageEvent => ({ type: notice.type, data: notice })));
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: {} })),
    );
    return merge(notices, heartbeat);
  }
}
