import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { pgSession } from '../src/adapters/pg.js';
import { describeEngineContract } from './contract.js';

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
let counter = 0;

beforeAll(async () => {
  // Same major version as PGlite and libpg-query (18). Default collation is en_US.utf8,
  // which is what makes the ordering test meaningful.
  container = await new PostgreSqlContainer('postgres:18-alpine').start();
  admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
});

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

// One database per test, as T1 does per session (ADR 0001).
describeEngineContract('PostgreSQL', async () => {
  const name = `contract_${++counter}`;
  await admin.query(`create database ${name}`);
  const client = new pg.Client({
    connectionString: container.getConnectionUri().replace(/\/[^/]*$/, `/${name}`),
  });
  await client.connect();
  return {
    db: pgSession(client),
    dispose: async () => {
      await client.end();
      await admin.query(`drop database ${name}`);
    },
  };
});
