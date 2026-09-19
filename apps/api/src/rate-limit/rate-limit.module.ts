import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../infrastructure/infrastructure.module.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RateLimiter } from './rate-limiter.js';

@Module({
  providers: [
    { provide: RateLimiter, inject: [REDIS], useFactory: (redis: Redis) => new RateLimiter(redis) },
    RateLimitGuard,
  ],
  exports: [RateLimiter, RateLimitGuard],
})
export class RateLimitModule {}
