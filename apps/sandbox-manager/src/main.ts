import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { DockerClient } from './provider/docker/docker-client.js';
import { migrate } from './store/migrate.js';
import { PgStore } from './store/pg-store.js';

const config = loadConfig();

const pool = new pg.Pool({
  connectionString: config.STATE_DATABASE_URL,
  max: 10,
  // A database that stops answering must surface as an error, not a hung promise: the
  // reconciliation loop falls back to the container labels when it does (ADR 0002).
  connectionTimeoutMillis: 3_000,
  query_timeout: 10_000,
});
// An idle client that loses its connection emits here; without a listener it crashes the
// process. The next query simply opens a new connection.
pool.on('error', () => {});

await migrate(pool);
const store = new PgStore(pool);
const docker = new DockerClient(config.DOCKER_HOST);

const app = buildApp({
  config,
  checks: [
    { name: 'state-database', check: () => store.ping() },
    { name: 'docker', check: () => docker.ping() },
  ],
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
