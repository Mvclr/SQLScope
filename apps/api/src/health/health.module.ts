import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { CONTROL_DB, REDIS, SANDBOX_DB } from '../infrastructure/infrastructure.module.js';
import { HEALTH_CHECKS, type HealthCheck } from './health-check.js';
import { HealthController } from './health.controller.js';

const postgres = (name: string, pool: pg.Pool): HealthCheck => ({
  name,
  check: async () => {
    await pool.query('select 1');
  },
});

const redis = (client: Redis): HealthCheck => ({
  name: 'redis',
  check: async () => {
    if (client.status === 'wait') await client.connect();
    await client.ping();
  },
});

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: HEALTH_CHECKS,
      inject: [CONTROL_DB, SANDBOX_DB, REDIS],
      useFactory: (controlDb: pg.Pool, sandboxDb: pg.Pool, client: Redis): HealthCheck[] => [
        postgres('controlDatabase', controlDb),
        postgres('sandboxCluster', sandboxDb),
        redis(client),
      ],
    },
  ],
})
export class HealthModule {}
