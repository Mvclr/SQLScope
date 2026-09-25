import type { Config } from '../../config.js';
import type { SandboxId } from '../../domain/sandbox.js';
import type { SandboxSpec } from '../provider.js';

/** Labels on every container and network the manager creates. */
export const LABELS = {
  /** Which manager instance owns the resource; reconciliation only touches its own. */
  managedBy: 'sqlscope.managed-by',
  sandboxId: 'sqlscope.sandbox-id',
  /** ISO 8601 deadline, enough to reap the resource with the database down. */
  expiresAt: 'sqlscope.expires-at',
} as const;

/** UID and GID of `postgres` in the official Alpine image. */
const POSTGRES_UID = 70;
export const SANDBOX_PORT = 5432;
export const LAB_DATABASE = 'lab';
export const LAB_ROLE = 'lab';
const MIB = 1024 * 1024;

export interface ContainerLimits {
  readonly instance: string;
  readonly image: string;
  readonly memoryMb: number;
  readonly diskMb: number;
  readonly cpus: number;
  readonly pids: number;
}

export function limitsFrom(config: Config): ContainerLimits {
  return {
    instance: config.MANAGER_INSTANCE,
    image: config.T2_IMAGE,
    memoryMb: config.T2_MEMORY_MB,
    diskMb: config.T2_DISK_MB,
    cpus: config.T2_CPUS,
    pids: config.T2_PIDS,
  };
}

/** Name of both the container and its network: `t2_abc…` → `sqlscope-t2-abc…`. */
export function resourceName(id: SandboxId): string {
  return `sqlscope-${id.replace('_', '-')}`;
}

export function labelsFor(id: SandboxId, expiresAt: Date, limits: ContainerLimits) {
  return {
    [LABELS.managedBy]: limits.instance,
    [LABELS.sandboxId]: id,
    [LABELS.expiresAt]: expiresAt.toISOString(),
  };
}

/**
 * SQL the entrypoint runs as superuser in the `lab` database, before the seed. The `lab`
 * role follows ADR 0001: not a superuser, no CREATEROLE or CREATEDB, and a connection
 * limit; it only connects to its own database.
 */
export function initSql(labPassword: string): string {
  // Interpolated into a literal, so only hex gets through.
  if (!/^[0-9a-f]{16,}$/.test(labPassword)) throw new Error('lab password must be hex');
  return [
    `create role ${LAB_ROLE} login nosuperuser nocreaterole nocreatedb connection limit 15 password '${labPassword}';`,
    // Defaults only: the role can SET them (ADR 0001); the container limits are the bound.
    `alter role ${LAB_ROLE} set statement_timeout = '30s';`,
    `alter role ${LAB_ROLE} set idle_in_transaction_session_timeout = '10min';`,
    `revoke all on database ${LAB_DATABASE} from public;`,
    `revoke connect on database postgres from public;`,
    `revoke connect on database template1 from public;`,
    `grant connect, temporary on database ${LAB_DATABASE} to ${LAB_ROLE};`,
    `grant usage, create on schema public to ${LAB_ROLE};`,
  ].join('\n');
}

/**
 * The init scripts arrive through the environment and are written to a tmpfs, because the
 * root filesystem is read-only and the image has nothing of ours in it. Then the stock
 * entrypoint takes over as PID 1.
 */
const ENTRYPOINT = [
  'set -eu',
  'umask 077',
  `printf '%s\\n' "$SQLSCOPE_INIT_SQL" > /docker-entrypoint-initdb.d/01-lab.sql`,
  `printf '%s\\n' "$SQLSCOPE_SEED" > /docker-entrypoint-initdb.d/02-seed.sql`,
  'unset SQLSCOPE_INIT_SQL SQLSCOPE_SEED',
  'exec docker-entrypoint.sh "$@"',
].join('\n');

function tmpfs(sizeMb: number, mode: string): string {
  return `rw,nosuid,nodev,noexec,size=${sizeMb}m,uid=${POSTGRES_UID},gid=${POSTGRES_UID},mode=${mode}`;
}

/**
 * The `POST /containers/create` body for one sandbox. Built only from the sandbox spec and
 * the manager's config — never from request fields — because the socket proxy allows the
 * whole containers API: this function is what keeps a sandbox unprivileged (ADR 0002,
 * "Ajustes da implementação"). A unit test pins every setting below.
 */
export function containerSpec(
  spec: SandboxSpec,
  limits: ContainerLimits,
  superuserPassword: string,
): Record<string, unknown> {
  const network = resourceName(spec.id);
  const memoryBytes = limits.memoryMb * MIB;
  return {
    Image: limits.image,
    User: `${POSTGRES_UID}:${POSTGRES_UID}`,
    Labels: labelsFor(spec.id, spec.expiresAt, limits),
    Entrypoint: ['sh', '-c', ENTRYPOINT, 'sqlscope-t2'],
    Cmd: [
      'postgres',
      '-c',
      'max_connections=20',
      '-c',
      `shared_buffers=${Math.max(16, Math.floor(limits.memoryMb / 8))}MB`,
      // Temporary files live on the same tmpfs; half of it for them, half for the data.
      '-c',
      `temp_file_limit=${Math.max(1, Math.floor(limits.diskMb / 2))}MB`,
      // Keeps statements, and the passwords in them, out of the log.
      '-c',
      'log_min_error_statement=panic',
    ],
    Env: [
      // Random and discarded by the manager: nobody logs in as superuser over the network.
      `POSTGRES_PASSWORD=${superuserPassword}`,
      `POSTGRES_DB=${LAB_DATABASE}`,
      // Trust only on the Unix socket, which the init scripts use; passwords on TCP.
      'POSTGRES_INITDB_ARGS=--auth-local=trust --auth-host=scram-sha-256',
      `SQLSCOPE_INIT_SQL=${initSql(spec.labPassword)}`,
      `SQLSCOPE_SEED=${spec.seed}`,
    ],
    ExposedPorts: { [`${SANDBOX_PORT}/tcp`]: {} },
    // Passes only once initialization is over: the temporary server it runs listens on the
    // Unix socket alone.
    Healthcheck: {
      Test: ['CMD', 'pg_isready', '-q', '-h', '127.0.0.1', '-p', String(SANDBOX_PORT)],
      Interval: 1_000_000_000,
      Timeout: 3_000_000_000,
      Retries: 3,
    },
    HostConfig: {
      NetworkMode: network,
      Privileged: false,
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Memory: memoryBytes,
      // Equal to Memory: no swap to spill into.
      MemorySwap: memoryBytes,
      NanoCpus: Math.round(limits.cpus * 1e9),
      PidsLimit: limits.pids,
      // The cluster lives in memory: the size is the disk quota, and it is gone with the
      // container, which is what a disposable sandbox should do.
      Tmpfs: {
        '/var/lib/postgresql': tmpfs(limits.diskMb, '0700'),
        '/var/run/postgresql': tmpfs(1, '0775'),
        '/docker-entrypoint-initdb.d': tmpfs(1, '0700'),
        '/tmp': tmpfs(16, '1777'),
      },
      ShmSize: 64 * MIB,
      RestartPolicy: { Name: 'no' },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '1m', 'max-file': '1' } },
    },
    NetworkingConfig: { EndpointsConfig: { [network]: {} } },
  };
}
