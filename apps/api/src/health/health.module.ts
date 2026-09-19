import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PRISMA, REDIS, SANDBOX_DB } from '../infrastructure/infrastructure.module.js';
import { HEALTH_CHECKS, type HealthCheck } from './health-check.js';
import { HealthController } from './health.controller.js';

const controlDatabase = (prisma: PrismaClient): HealthCheck => ({
  name: 'controlDatabase',
  check: async () => {
    await prisma.$queryRaw`select 1`;
  },
});

const sandboxCluster = (pool: pg.Pool): HealthCheck => ({
  name: 'sandboxCluster',
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
      inject: [PRISMA, SANDBOX_DB, REDIS],
      useFactory: (prisma: PrismaClient, sandboxDb: pg.Pool, client: Redis): HealthCheck[] => [
        controlDatabase(prisma),
        sandboxCluster(sandboxDb),
        redis(client),
      ],
    },
  ],
})
export class HealthModule {}
