import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { migrate } from '../../src/store/migrate.js';

export interface StateDatabase {
  readonly container: StartedPostgreSqlContainer;
  readonly pool: pg.Pool;
  /** Empties both tables between tests. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/** A migrated state database, as the manager finds it in production. */
export async function startStateDatabase(): Promise<StateDatabase> {
  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 10 });
  pool.on('error', () => {});
  await migrate(pool);
  return {
    container,
    pool,
    async reset() {
      await pool.query('truncate sandboxes, sandbox_transitions');
    },
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
