import { randomBytes } from 'node:crypto';
import { findLab } from '@sqlscope/labs';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { SessionEventBus, type SessionNotice } from '../src/events/session-event-bus.js';
import { createPrisma } from '../src/infrastructure/infrastructure.module.js';
import type { PrismaClient, Session } from '../src/generated/prisma/client.js';
import { LabConnections, type SandboxConnection } from '../src/labs/lab-connections.js';
import { LabRunService } from '../src/labs/lab-run.service.js';
import { LabRunWatcher } from '../src/labs/lab-run.watcher.js';
import {
  ManagerAtCapacityError,
  SandboxManagerClient,
  type ManagerSandbox,
  type ManagerStatus,
} from '../src/labs/sandbox-manager.client.js';
import type { SessionService } from '../src/sessions/session.service.js';
import { startStack, type Stack } from './support/stack.js';

const LAB_PASSWORD = 'ab'.repeat(12);
const LAB_ID = 'sql-injection-app';

let stack: Stack;
let prisma: PrismaClient;
let bus: SessionEventBus;
let connections: LabConnections;
let manager: StubManager;
let service: LabRunService;
let labRoleReady = false;

const config = () =>
  loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-secret-that-is-at-least-32-chars',
    SANDBOX_MANAGER_TOKEN: 'test-manager-token-that-is-32-chars-min',
    CONTROL_DATABASE_URL: stack.control.getConnectionUri(),
    SANDBOX_DATABASE_URL: stack.sandbox.getConnectionUri(),
    REDIS_URL: stack.redis.getConnectionUrl(),
    STATEMENT_TIMEOUT_MS: '800',
  });

/** Prepares a real database as the manager's container would: the `lab` role, then the seed. */
async function provisionFakeSandbox(seed: string): Promise<SandboxConnection> {
  const admin = stack.sandboxAdmin;
  if (!labRoleReady) {
    await admin.query(
      `create role lab login password '${LAB_PASSWORD}' nosuperuser nocreatedb nocreaterole`,
    );
    labRoleReady = true;
  }
  const database = `sbxlab_${randomBytes(12).toString('hex')}`;
  await admin.query(`create database ${database}`);
  const url = new URL(stack.sandbox.getConnectionUri());
  url.pathname = `/${database}`;
  const inDb = new pg.Client({ connectionString: url.toString() });
  await inDb.connect();
  try {
    await inDb.query('grant usage on schema public to lab');
    await inDb.query(seed);
  } finally {
    await inDb.end();
  }
  return {
    host: url.hostname,
    port: Number(url.port),
    database,
    user: 'lab',
    password: LAB_PASSWORD,
  };
}

/** The sandbox manager, stubbed, backed by real databases so the SQL path is real. */
class StubManager extends SandboxManagerClient {
  private readonly store = new Map<
    string,
    {
      seed: string;
      status: ManagerStatus;
      connection: SandboxConnection | null;
      position: number | null;
    }
  >();
  atCapacity = false;
  startQueued = false;

  constructor() {
    super('http://stub:4100', 'x'.repeat(40));
  }

  override async create(input: { requestId: string; seed: string }): Promise<ManagerSandbox> {
    if (this.atCapacity) throw new ManagerAtCapacityError();
    const id = `t2_${randomBytes(12).toString('hex')}`;
    if (this.startQueued) {
      this.store.set(id, { seed: input.seed, status: 'PENDING', connection: null, position: 2 });
    } else {
      const connection = await provisionFakeSandbox(input.seed);
      this.store.set(id, { seed: input.seed, status: 'READY', connection, position: null });
    }
    return this.view(id);
  }

  override async get(id: string): Promise<ManagerSandbox | null> {
    return this.store.has(id) ? this.view(id) : null;
  }

  override async heartbeat(id: string): Promise<ManagerSandbox | null> {
    const sandbox = this.store.get(id);
    if (!sandbox) return null;
    if (sandbox.status === 'READY' || sandbox.status === 'ACTIVE') {
      sandbox.status = 'ACTIVE';
      return this.view(id);
    }
    return null;
  }

  override async release(id: string): Promise<void> {
    this.store.delete(id);
  }

  // --- test controls ---
  onlyId(): string {
    return [...this.store.keys()][0]!;
  }
  async makeReady(id: string): Promise<void> {
    const sandbox = this.store.get(id)!;
    sandbox.connection = await provisionFakeSandbox(sandbox.seed);
    sandbox.status = 'READY';
    sandbox.position = null;
  }
  end(id: string, status: ManagerStatus = 'DESTROYED'): void {
    const sandbox = this.store.get(id);
    if (sandbox) {
      sandbox.status = status;
      sandbox.connection = null;
    }
  }

  private view(id: string): ManagerSandbox {
    const s = this.store.get(id)!;
    const ended = !['PENDING', 'PROVISIONING', 'READY', 'ACTIVE'].includes(s.status);
    return {
      id,
      status: s.status,
      queuePosition: s.position,
      expiresAt: null,
      idleExpiresAt: null,
      endReason: ended ? 'released' : null,
      failure: null,
      connection: s.connection,
    };
  }
}

const stubSessions = { touch: async () => undefined } as unknown as SessionService;

let sessionSeq = 0;
async function newSession(): Promise<Session> {
  return prisma.session.create({
    data: {
      databaseName: `sbx_${randomBytes(12).toString('hex')}`,
      rolePassword: 'unused',
      clientHash: `client-${++sessionSeq}`,
      status: 'ACTIVE',
    },
  });
}

/** Collects the notices published to a session's stream. */
function collect(sessionId: string): { notices: SessionNotice[]; stop: () => void } {
  const notices: SessionNotice[] = [];
  const sub = bus.stream(sessionId).subscribe((notice) => notices.push(notice));
  return { notices, stop: () => sub.unsubscribe() };
}

beforeAll(async () => {
  stack = await startStack();
  prisma = createPrisma(stack.control.getConnectionUri());
});

afterAll(async () => {
  await connections?.releaseAll();
  await prisma?.$disconnect();
  await stack?.stop();
});

beforeEach(() => {
  bus = new SessionEventBus();
  connections = new LabConnections(config().STATEMENT_TIMEOUT_MS);
  manager = new StubManager();
  service = new LabRunService(prisma, config(), manager, connections, stubSessions, bus);
});

afterEach(async () => {
  await connections.releaseAll();
  await prisma.labRun.deleteMany();
});

describe('lab run lifecycle', () => {
  it('starts a lab, claims it, and drives the mini-app through every step', async () => {
    const session = await newSession();
    const feed = collect(session.id);

    const started = await service.start(session, LAB_ID);
    expect(started.ok && started.value.status).toBe('READY');
    expect(feed.notices).toContainEqual({ type: 'lab-ready' });

    const claimed = await service.claim(session.id);
    expect(claimed.ok && claimed.value.status).toBe('ACTIVE');

    // Every app step of the lab, against a real sandbox, as the unprivileged lab role.
    const lab = findLab(LAB_ID)!;
    for (const step of lab.steps) {
      const outcome = await service.runApp(session.id, step.input!, step.mode!);
      expect(outcome.ok, step.id).toBe(true);
      if (!outcome.ok) continue;
      if (step.refused !== undefined) {
        expect(outcome.value.result.ok, step.id).toBe(false);
        if (!outcome.value.result.ok) expect(outcome.value.result.error.code).toBe(step.refused);
      } else {
        expect(outcome.value.result.ok, step.id).toBe(true);
        if (outcome.value.result.ok) {
          expect(outcome.value.result.rows.length, step.id).toBe(step.rows);
        }
      }
    }
    feed.stop();
  });

  it('exposes the built query text and values to the caller', async () => {
    const session = await newSession();
    await service.start(session, LAB_ID);
    const concatenated = await service.runApp(session.id, "' or '1'='1", 'concatenated');
    expect(concatenated.ok && concatenated.value.text).toContain("email = '' or '1'='1'");
    expect(concatenated.ok && concatenated.value.values).toEqual([]);

    const parameterized = await service.runApp(session.id, "' or '1'='1", 'parameterized');
    expect(parameterized.ok && parameterized.value.text).toContain('email = $1');
    expect(parameterized.ok && parameterized.value.values).toEqual(["' or '1'='1"]);
  });

  it('runs the learner console on the sandbox', async () => {
    const session = await newSession();
    await service.start(session, LAB_ID);
    const result = await service.runConsole(session.id, 'select count(*) from usuarios;');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const last = result.value.statements.at(-1)!;
      expect(last.status).toBe('ok');
      if (last.status === 'ok') expect(last.output.rows).toEqual([['3']]);
    }
  });

  it('cancels a statement that outlives the limit, without superuser', async () => {
    const session = await newSession();
    await service.start(session, LAB_ID);
    // The learner disables their own timeout; the API's watchdog still cancels from outside.
    const result = await service.runConsole(
      session.id,
      'set statement_timeout = 0; select pg_sleep(3);',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sleep = result.value.statements.at(-1)!;
      expect(sleep.status).toBe('error');
      if (sleep.status === 'error') {
        expect(sleep.error.code).toBe('57014');
        expect(sleep.error.message).toMatch(/exceeded the 800 ms limit/);
      }
    }
  });

  it('is idempotent: a second start returns the running lab', async () => {
    const session = await newSession();
    const first = await service.start(session, LAB_ID);
    const again = await service.start(session, LAB_ID);
    expect(first.ok && again.ok).toBe(true);
    expect(await prisma.labRun.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it('refuses a lab that does not run on the server', async () => {
    const session = await newSession();
    const result = await service.start(session, 'sql-injection');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('unknown-lab');
  });

  it('refuses to start a second lab for the same client', async () => {
    const a = await newSession();
    await prisma.session.update({ where: { id: a.id }, data: { clientHash: 'shared' } });
    const b = await newSession();
    await prisma.session.update({ where: { id: b.id }, data: { clientHash: 'shared' } });
    expect((await service.start({ ...a, clientHash: 'shared' }, LAB_ID)).ok).toBe(true);
    const second = await service.start({ ...b, clientHash: 'shared' }, LAB_ID);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('client-limit');
  });

  it('turns a full queue into a capacity refusal', async () => {
    const session = await newSession();
    manager.atCapacity = true;
    const result = await service.start(session, LAB_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('capacity');
    // The refused run left no row behind.
    expect(await prisma.labRun.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it('reports the queue position, then ready, as notices', async () => {
    const session = await newSession();
    const feed = collect(session.id);
    manager.startQueued = true;
    const started = await service.start(session, LAB_ID);
    expect(started.ok && started.value.status).toBe('PENDING');
    expect(feed.notices).toContainEqual({ type: 'lab-queued', position: 2 });

    await manager.makeReady(manager.onlyId());
    await service.status(session.id);
    expect(feed.notices).toContainEqual({ type: 'lab-ready' });
    feed.stop();
  });

  it('releases the lab and tears the binding down', async () => {
    const session = await newSession();
    const feed = collect(session.id);
    await service.start(session, LAB_ID);
    expect(await service.release(session.id)).toBe(true);
    expect(await prisma.labRun.findUnique({ where: { sessionId: session.id } })).toBeNull();
    expect(feed.notices.at(-1)).toEqual({ type: 'lab-ended', reason: 'released' });
    // The sandbox is not usable any more.
    const after = await service.runApp(session.id, 'ana@exemplo.com', 'concatenated');
    expect(after.ok).toBe(false);
    feed.stop();
  });
});

describe('lab run watcher', () => {
  function watcher() {
    return new LabRunWatcher(config(), service, manager);
  }

  it('cleans up a run once its sandbox ends, and notifies', async () => {
    const session = await newSession();
    const feed = collect(session.id);
    await service.start(session, LAB_ID);
    manager.end(manager.onlyId());

    await watcher().tick();
    expect(await prisma.labRun.findUnique({ where: { sessionId: session.id } })).toBeNull();
    expect(feed.notices.at(-1)).toEqual({ type: 'lab-ended', reason: 'released' });
    feed.stop();
  });

  it('ends a run whose owning session is no longer active', async () => {
    const session = await newSession();
    await service.start(session, LAB_ID);
    const sandboxId = manager.onlyId();
    await prisma.session.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });

    await watcher().tick();
    expect(await prisma.labRun.findUnique({ where: { sessionId: session.id } })).toBeNull();
    // The watcher released the sandbox at the manager, too.
    expect(await manager.get(sandboxId)).toBeNull();
  });
});
