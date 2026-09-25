import pg from 'pg';
import { pino } from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { Scheduler } from './lifecycle/scheduler.js';
import { systemClock } from './log.js';
import { limitsFrom } from './provider/docker/container-spec.js';
import { DockerClient } from './provider/docker/docker-client.js';
import { DockerProvider } from './provider/docker/docker-provider.js';
import { migrate } from './store/migrate.js';
import { PgStore } from './store/pg-store.js';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });

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
pool.on('error', (error) => log.warn(`state database connection lost: ${error.message}`));

await migrate(pool);
const store = new PgStore(pool);
const docker = new DockerClient(config.DOCKER_HOST);
const provider = new DockerProvider(docker, {
  limits: limitsFrom(config),
  attach: config.SANDBOX_ATTACH_CONTAINERS,
  provisionTimeoutMs: config.PROVISION_TIMEOUT_SECONDS * 1000,
});
const scheduler = new Scheduler(
  store,
  provider,
  {
    maxActive: config.MAX_ACTIVE_SANDBOXES,
    maxQueue: config.MAX_QUEUE,
    provisionTimeoutSeconds: config.PROVISION_TIMEOUT_SECONDS,
  },
  systemClock,
  log,
);

const app = buildApp({
  config,
  logger: log,
  store,
  scheduler,
  checks: [
    { name: 'state-database', check: () => store.ping() },
    { name: 'docker', check: () => docker.ping() },
  ],
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info(`${signal} received, shutting down`);
  await app.close();
  // A provisioning cut short would leave its record for the next process to fail as
  // stuck; letting it finish is cheaper, and bounded by PROVISION_TIMEOUT_SECONDS.
  await scheduler.drain();
  await pool.end();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}

await app.listen({ port: config.PORT, host: '0.0.0.0' });
