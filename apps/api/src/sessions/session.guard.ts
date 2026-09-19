import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Session } from '../generated/prisma/client.js';
import { SessionService } from './session.service.js';

export const SESSION_COOKIE = 'sqlscope_session';

const SESSION = Symbol('SESSION');

type WithSession = Request & { [SESSION]?: Session };

/** Resolves the signed session cookie to an active session, or answers 401. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WithSession>();
    const id = sessionIdFromCookie(request);
    const session = id ? await this.sessions.findActive(id) : null;
    if (!session) {
      throw new UnauthorizedException({
        message: 'Sessão inexistente ou expirada.',
        code: 'no-session',
      });
    }
    request[SESSION] = session;
    return true;
  }
}

/** `signedCookies` holds `false` for a cookie whose signature does not verify. */
export function sessionIdFromCookie(request: Request): string | null {
  const value: unknown = request.signedCookies?.[SESSION_COOKIE];
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) ? value : null;
}

export function sessionOf(request: Request): Session {
  const session = (request as WithSession)[SESSION];
  if (!session) throw new Error('SessionGuard did not run for this route');
  return session;
}
