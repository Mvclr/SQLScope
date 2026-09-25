import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();

const pool = new pg.Pool({ connectionString: config.STATE_DATABASE_URL, max: 10 });
// An idle client that loses its connection emits here; without a listener it crashes the
// process. The next query simply opens a new connection.
pool.on('error', () => {});

const app = buildApp({
  config,
  checks: [{ name: 'state-database', check: async () => void (await pool.query('select 1')) }],
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await pool.end();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}

await app.listen({ port: config.PORT, host: '0.0.0.0' });
