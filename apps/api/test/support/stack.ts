import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import { loadConfig, type Config } from '../../src/config.js';

const PROVISIONER_PASSWORD = 'provisioner-test-password';

export interface Stack {
  readonly control: StartedPostgreSqlContainer;
  readonly sandbox: StartedPostgreSqlContainer;
  readonly redis: StartedRedisContainer;
  /** Superuser on the sandbox cluster, for assertions only. */
  readonly sandboxAdmin: pg.Client;
  stop(): Promise<void>;
}

/** Real control database, sandbox cluster and Redis, as compose runs them. */
export async function startStack(): Promise<Stack> {
  const [control, sandbox, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:18-alpine').start(),
    new PostgreSqlContainer('postgres:18-alpine').start(),
    new RedisContainer('redis:8-alpine').start(),
  ]);

  await applyMigrations(control.getConnectionUri());

  const sandboxAdmin = new pg.Client({ connectionString: sandbox.getConnectionUri() });
  await sandboxAdmin.connect();
  // Mirrors infra/postgres-sandbox/01-provisioner.sh.
  await sandboxAdmin.query(
    `create role sqlscope_provisioner login createdb createrole password '${PROVISIONER_PASSWORD}'`,
  );
  await sandboxAdmin.query(`revoke connect on database ${sandbox.getDatabase()} from public`);
  await sandboxAdmin.query(`revoke connect on database template1 from public`);
  await sandboxAdmin.query(
    `grant connect on database ${sandbox.getDatabase()} to sqlscope_provisioner`,
  );

  return {
    control,
    sandbox,
    redis,
    sandboxAdmin,
    async stop() {
      await sandboxAdmin.end();
      await Promise.all([control.stop(), sandbox.stop(), redis.stop()]);
    },
  };
}

export function configFor(stack: Stack, overrides: Partial<Record<string, string>> = {}): Config {
  const sandboxUrl = new URL(stack.sandbox.getConnectionUri());
  sandboxUrl.username = 'sqlscope_provisioner';
  sandboxUrl.password = PROVISIONER_PASSWORD;

  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    SESSION_SECRET: 'test-secret-that-is-at-least-32-chars',
    CONTROL_DATABASE_URL: stack.control.getConnectionUri(),
    SANDBOX_DATABASE_URL: sandboxUrl.toString(),
    REDIS_URL: stack.redis.getConnectionUrl(),
    ...overrides,
  });
}

export async function startApp(config: Config): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, config);
  await app.init();
  return app;
}

async function applyMigrations(connectionString: string): Promise<void> {
  const dir = path.join(import.meta.dirname, '../../prisma/migrations');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // Migration folders are timestamp-prefixed, so name order is apply order.
    const folders = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const folder of folders) {
      await client.query(await readFile(path.join(dir, folder, 'migration.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
}
