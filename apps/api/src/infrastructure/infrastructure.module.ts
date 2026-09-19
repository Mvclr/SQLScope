import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import pg from 'pg';
import { CONFIG, type Config } from '../config.js';

export const CONTROL_DB = Symbol('CONTROL_DB');
export const SANDBOX_DB = Symbol('SANDBOX_DB');
export const REDIS = Symbol('REDIS');

const logger = new Logger('Infrastructure');

/**
 * A pool emits `error` when the server drops one of its idle connections (restart,
 * failover, `pg_terminate_backend`). Unhandled, that event crashes the process. The pool
 * discards the broken connection and opens a new one on demand, so logging is enough.
 */
export function createPool(name: string, connectionString: string, max: number): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', (error) => logger.warn(`${name}: idle connection lost — ${error.message}`));
  return pool;
}

export function createRedis(url: string): Redis {
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', (error) => logger.warn(`redis: ${error.message}`));
  return redis;
}

/**
 * Connections to backing services. Kept separate so that the control database and the
 * sandbox cluster can never be confused: they are different tokens, different pools and
 * different credentials.
 */
@Global()
@Module({
  providers: [
    {
      provide: CONTROL_DB,
      inject: [CONFIG],
      useFactory: (config: Config) =>
        createPool('controlDatabase', config.CONTROL_DATABASE_URL, 10),
    },
    {
      provide: SANDBOX_DB,
      inject: [CONFIG],
      useFactory: (config: Config) => createPool('sandboxCluster', config.SANDBOX_DATABASE_URL, 5),
    },
    {
      provide: REDIS,
      inject: [CONFIG],
      useFactory: (config: Config) => createRedis(config.REDIS_URL),
    },
  ],
  exports: [CONTROL_DB, SANDBOX_DB, REDIS],
})
export class InfrastructureModule implements OnApplicationShutdown {
  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: pg.Pool,
    @Inject(SANDBOX_DB) private readonly sandboxDb: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.controlDb.end(), this.sandboxDb.end(), this.redis.quit()]);
  }
}
