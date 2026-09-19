import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { clientHashOf } from '../sessions/client-identity.js';
import { sessionOf } from '../sessions/session.guard.js';
import { RateLimiter } from './rate-limiter.js';

export interface RateLimitPolicy {
  /** Distinguishes counters of different endpoints. */
  readonly name: string;
  readonly windowSeconds: number;
  /** Requests per window from one client address. */
  readonly perClient: number;
  /** Requests per window within one session; needs SessionGuard before this guard. */
  readonly perSession?: number;
}

const POLICY = Symbol('RATE_LIMIT_POLICY');

export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(POLICY, policy);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<RateLimitPolicy | undefined>(POLICY, context.getHandler());
    if (!policy) return true;
    const request = context.switchToHttp().getRequest<Request>();

    const checks = [
      this.limiter.hit(
        `${policy.name}:c:${clientHashOf(request)}`,
        policy.perClient,
        policy.windowSeconds,
      ),
    ];
    if (policy.perSession !== undefined) {
      checks.push(
        this.limiter.hit(
          `${policy.name}:s:${sessionOf(request).id}`,
          policy.perSession,
          policy.windowSeconds,
        ),
      );
    }

    // Unlike most dependencies, a broken limiter fails closed: this API runs strangers' SQL.
    const outcomes = await Promise.all(checks).catch(() => {
      throw new HttpException('Rate limiter unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    });
    const denied = outcomes.find((o) => !o.allowed);
    if (denied) {
      context.switchToHttp().getResponse<Response>().setHeader('Retry-After', denied.retryAfter);
      throw new HttpException(
        {
          message: 'Muitas requisições. Tente novamente em instantes.',
          retryAfter: denied.retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
