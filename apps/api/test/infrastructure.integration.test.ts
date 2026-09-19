import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPool } from '../src/infrastructure/infrastructure.module.js';

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18-alpine').start();
});

afterAll(async () => {
  await container?.stop();
});

// Regression: an unhandled pool `error` event used to crash the API whenever the
// database dropped idle connections — e.g. on restart, or when T1 terminates the
// backends of an expired session.
it('survives the server terminating idle pooled connections', async () => {
  const pool = createPool('test', container.getConnectionUri(), 2);
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();

  try {
    const { rows } = await pool.query<{ pid: number }>('select pg_backend_pid() as pid');
    const pooledPid = rows[0]!.pid;

    await admin.query('select pg_terminate_backend($1)', [pooledPid]);
    // Wait for the pool to notice without attaching an 'error' listener of our own:
    // that would mask exactly the crash this test guards against.
    await expect.poll(() => pool.totalCount, { timeout: 5_000 }).toBe(0);

    const after = await pool.query<{ pid: number }>('select pg_backend_pid() as pid');
    expect(after.rows[0]!.pid).not.toBe(pooledPid);
  } finally {
    await admin.end();
    await pool.end();
  }
});
