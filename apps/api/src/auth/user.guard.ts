import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../generated/prisma/client.js';
import { AuthService } from './auth.service.js';

export const USER_COOKIE = 'sqlscope_user';

const USER = Symbol('USER');

type WithUser = Request & { [USER]?: User };

/** Resolves the signed account cookie, or answers 401. */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WithUser>();
    const id = userIdFromCookie(request);
    const user = id ? await this.auth.findById(id) : null;
    if (!user)
      throw new UnauthorizedException({ message: 'Entre para continuar.', code: 'no-user' });
    request[USER] = user;
    return true;
  }
}

/** `signedCookies` holds `false` for a cookie whose signature does not verify. */
export function userIdFromCookie(request: Request): string | null {
  const value: unknown = request.signedCookies?.[USER_COOKIE];
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) ? value : null;
}

export function userOf(request: Request): User {
  const user = (request as WithUser)[USER];
  if (!user) throw new Error('UserGuard did not run for this route');
  return user;
}
