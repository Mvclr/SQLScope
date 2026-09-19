import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { CONFIG, type Config } from '../config.js';
import { SessionLog } from '../events/session-log.js';
import type { Session } from '../generated/prisma/client.js';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { clientHashOf } from './client-identity.js';
import { SESSION_COOKIE, SessionGuard, sessionIdFromCookie, sessionOf } from './session.guard.js';
import { SessionService } from './session.service.js';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly log: SessionLog,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * Returns the caller's session, creating one if needed. Idempotent for a browser that
   * already holds a live session, so reloading the page never provisions a second sandbox.
   */
  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'create-session', windowSeconds: 3_600, perClient: 20 })
  async create(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const existingId = sessionIdFromCookie(request);
    const existing = existingId ? await this.sessions.findActive(existingId) : null;
    if (existing) {
      response.status(HttpStatus.OK);
      return this.describe(existing);
    }

    const created = await this.sessions.create(clientHashOf(request));
    if (!created.ok) {
      throw new HttpException(
        created.error === 'client-limit'
          ? { message: 'Você já tem o máximo de sessões ativas.', code: created.error }
          : {
              message: 'Todos os sandboxes estão ocupados. Tente em alguns minutos.',
              code: created.error,
            },
        created.error === 'client-limit'
          ? HttpStatus.TOO_MANY_REQUESTS
          : HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    response.cookie(SESSION_COOKIE, created.value.id, this.cookieOptions());
    response.status(HttpStatus.CREATED);
    return this.describe(created.value);
  }

  @Get('current')
  @UseGuards(SessionGuard)
  current(@Req() request: Request) {
    return this.describe(sessionOf(request));
  }

  @Get('current/history')
  @UseGuards(SessionGuard)
  history(@Req() request: Request) {
    return this.log.history(sessionOf(request).id);
  }

  @Delete('current')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.sessions.end(sessionOf(request), 'ended by user');
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  private async describe(session: Session) {
    const { idleExpiresAt, maxExpiresAt } = this.sessions.expiryOf(session);
    return {
      id: session.id,
      createdAt: session.createdAt,
      idleExpiresAt,
      maxExpiresAt,
      snapshot: (await this.log.latestSnapshot(session.id)) ?? { tables: [] },
      limits: {
        statementTimeoutMs: this.config.STATEMENT_TIMEOUT_MS,
        maxRows: this.config.RESULT_MAX_ROWS,
        idleMinutes: this.config.SESSION_IDLE_MINUTES,
      },
    };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: this.config.COOKIE_SECURE,
      path: '/',
      maxAge: this.config.SESSION_MAX_MINUTES * 60_000,
    };
  }
}
