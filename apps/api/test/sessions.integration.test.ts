import type { INestApplication } from '@nestjs/common';
import type { ScriptResult } from '@sqlscope/engine';
import pg from 'pg';
import { firstValueFrom } from 'rxjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { SessionEventBus } from '../src/events/session-event-bus.js';
import { PRISMA } from '../src/infrastructure/infrastructure.module.js';
import { RateLimiter } from '../src/rate-limit/rate-limiter.js';
import { newSandboxCredentials, SandboxProvisioner } from '../src/sandbox/provisioner.js';
import { SessionReaper } from '../src/sessions/session-reaper.js';
import { configFor, startApp, startStack, type Stack } from './support/stack.js';

let stack: Stack;
let app: INestApplication;
let clients = 0;

beforeAll(async () => {
  stack = await startStack();
  app = await startApp(
    configFor(stack, {
      // Requests carry X-Forwarded-For, as they do behind the web proxy.
      TRUST_PROXY: '1',
      STATEMENT_TIMEOUT_MS: '1000',
      MAX_SESSIONS_PER_CLIENT: '2',
    }),
  );
});

afterAll(async () => {
  await app?.close();
  await stack?.stop();
});

/** A browser: its own address and cookie jar. */
function browser() {
  const agent = request.agent(app.getHttpServer());
  const address = `203.0.113.${++clients}`;
  const send = <T extends request.Test>(test: T) => test.set('X-Forwarded-For', address);
  return {
    address,
    start: () => send(agent.post('/sessions')),
    run: async (sql: string): Promise<ScriptResult> =>
      (await send(agent.post('/sessions/current/execute')).send({ sql }).expect(200)).body,
    get: (path: string) => send(agent.get(path)),
    delete: (path: string) => send(agent.delete(path)),
  };
}

async function sandboxExists(name: string): Promise<boolean> {
  const { rows } = await stack.sandboxAdmin.query(
    `select 1 from pg_database where datname = $1 union all select 1 from pg_roles where rolname = $1`,
    [name],
  );
  return rows.length > 0;
}

async function databaseOf(sessionId: string): Promise<string> {
  const prisma = app.get<PrismaClient>(PRISMA);
  return (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).databaseName;
}

describe('session lifecycle', () => {
  it('creates a sandbox and a signed, httpOnly cookie; creating again returns the same session', async () => {
    const b = browser();

    const created = await b.start().expect(201);
    expect(created.headers['set-cookie']?.[0]).toMatch(/sqlscope_session=s%3A.+HttpOnly/);
    expect(created.body).toMatchObject({ snapshot: { tables: [] }, limits: { maxRows: 1000 } });
    expect(await sandboxExists(await databaseOf(created.body.id))).toBe(true);

    const again = await b.start().expect(200);
    expect(again.body.id).toBe(created.body.id);
  });

  it('rejects requests without a session, or with a forged cookie', async () => {
    await request(app.getHttpServer())
      .post('/sessions/current/execute')
      .send({ sql: 'select 1' })
      .expect(401);

    const b = browser();
    const { body } = await b.start().expect(201);
    await request(app.getHttpServer())
      .post('/sessions/current/execute')
      .set('Cookie', `sqlscope_session=${body.id}`)
      .send({ sql: 'select 1' })
      .expect(401);
  });

  it('limits how many sessions one client address holds at once', async () => {
    const address = '198.51.100.7';
    const start = () =>
      request(app.getHttpServer()).post('/sessions').set('X-Forwarded-For', address);

    await start().expect(201);
    await start().expect(201);
    const refused = await start().expect(429);
    expect(refused.body.code).toBe('client-limit');
  });

  it('ends a session on request: the sandbox is dropped and the cookie stops working', async () => {
    const b = browser();
    const { body } = await b.start().expect(201);
    const database = await databaseOf(body.id);

    await b.delete('/sessions/current').expect(204);

    expect(await sandboxExists(database)).toBe(false);
    await b.get('/sessions/current').expect(401);
  });
});

describe('execution', () => {
  it('runs scripts and reports results and schema changes', async () => {
    const b = browser();
    await b.start().expect(201);

    const created = await b.run(
      `create table users (id int primary key, name text); insert into users values (1, 'Ana')`,
    );
    expect(created.statements.map((s) => s.status)).toEqual(['ok', 'ok']);
    expect(created.schema?.changes).toMatchObject([
      { type: 'table-created', table: { name: 'users' } },
    ]);

    const selected = await b.run('select * from users');
    expect(selected.statements[0]).toMatchObject({ output: { rows: [['1', 'Ana']] } });
    expect(selected.schema).toBeNull();

    const current = await b.get('/sessions/current').expect(200);
    expect(current.body.snapshot.tables.map((t: { name: string }) => t.name)).toEqual(['users']);
  });

  it('keeps a transaction open across requests', async () => {
    const b = browser();
    await b.start().expect(201);
    await b.run('create table t (id int)');

    await b.run('begin; insert into t values (1)');
    expect((await b.run('select count(*) from t')).statements[0]).toMatchObject({
      output: { rows: [['1']] },
    });
    await b.run('rollback');
    expect((await b.run('select count(*) from t')).statements[0]).toMatchObject({
      output: { rows: [['0']] },
    });
  });

  it('returns SQL errors as results, with their position in the script', async () => {
    const b = browser();
    await b.start().expect(201);
    const sql = 'select 1;\nselect * from nowhere';

    const result = await b.run(sql);

    const failed = result.statements[1];
    expect(failed).toMatchObject({ status: 'error', error: { code: '42P01' } });
    if (failed?.status === 'error') {
      expect(sql.slice(failed.error.scriptPosition!)).toMatch(/^nowhere/);
    }
  });

  it('records statements and schema changes in the session history', async () => {
    const b = browser();
    await b.start().expect(201);
    await b.run('create table h (id int); select 1/0');

    const history = await b.get('/sessions/current/history').expect(200);

    expect(history.body.map((e: { type: string }) => e.type)).toEqual([
      'StatementExecuted',
      'StatementFailed',
      'SchemaChanged',
    ]);
  });
});

describe('sandbox isolation (ADR 0001)', () => {
  let b: ReturnType<typeof browser>;

  beforeAll(async () => {
    b = browser();
    await b.start().expect(201);
  });

  const failure = async (sql: string) => {
    const [statement] = (await b.run(sql)).statements;
    return statement?.status === 'error' ? statement.error.code : 'succeeded';
  };

  it('runs as an unprivileged role', async () => {
    const result = await b.run(
      `select rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = current_user`,
    );
    expect(result.statements[0]).toMatchObject({ output: { rows: [['f', 'f', 'f']] } });
  });

  it.each([
    ['run shell commands', `copy (select 1) to program 'id'`, '42501'],
    ['read server files', `select pg_read_file('/etc/passwd')`, '42501'],
    ['grant itself superuser', `alter role current_user superuser`, '42501'],
    ['become the provisioner', `set role sqlscope_provisioner`, '42501'],
    ['install untrusted extensions', `create extension dblink`, '42501'],
  ])('cannot %s', async (_, sql, code) => {
    expect(await failure(sql)).toBe(code);
  });

  it("cannot connect to another session's database", async () => {
    const other = browser();
    const { body } = await other.start().expect(201);
    const prisma = app.get<PrismaClient>(PRISMA);
    const mine = await prisma.session.findFirstOrThrow({
      where: { status: 'ACTIVE', NOT: { id: body.id } },
    });
    const theirs = await databaseOf(body.id);

    // My role's credentials, aimed at their database.
    const url = new URL(
      SandboxProvisioner.connectionString(stack.sandbox.getConnectionUri(), {
        databaseName: mine.databaseName,
        password: mine.rolePassword,
      }),
    );
    url.pathname = `/${theirs}`;
    const intruder = new pg.Client({ connectionString: url.toString() });

    await expect(intruder.connect()).rejects.toThrow(/permission denied for database/);
  });

  it('cancels a statement past the limit even after SET statement_timeout = 0', async () => {
    const startedAt = Date.now();

    const result = await b.run('set statement_timeout = 0; select pg_sleep(30)');

    expect(result.statements[1]).toMatchObject({
      status: 'error',
      error: { code: '57014', message: expect.stringMatching(/exceeded the 1000 ms limit/) },
    });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});

describe('reaper', () => {
  it('destroys idle sessions and sandboxes no session owns', async () => {
    const b = browser();
    const { body } = await b.start().expect(201);
    const database = await databaseOf(body.id);
    const prisma = app.get<PrismaClient>(PRISMA);
    await prisma.session.update({
      where: { id: body.id },
      data: { lastActiveAt: new Date(Date.now() - 60 * 60_000) },
    });

    // What a crash between provisioning and recording the session leaves behind.
    const orphan = newSandboxCredentials();
    await app.get(SandboxProvisioner).create(orphan, { statementTimeoutMs: 1000 });

    await app.get(SessionReaper).sweep();

    expect(await sandboxExists(database)).toBe(false);
    expect(await sandboxExists(orphan.databaseName)).toBe(false);
    expect(await prisma.session.findUnique({ where: { id: body.id } })).toMatchObject({
      status: 'DESTROYED',
      endReason: 'idle',
    });
    await b.get('/sessions/current').expect(401);
  });
});

describe('rate limiting and notifications', () => {
  it('counts requests per key in fixed windows', async () => {
    const limiter = app.get(RateLimiter);
    const key = `test:${Date.now()}`;

    expect((await limiter.hit(key, 2, 60)).allowed).toBe(true);
    expect((await limiter.hit(key, 2, 60)).allowed).toBe(true);
    const third = await limiter.hit(key, 2, 60);

    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
    expect(third.retryAfter).toBeLessThanOrEqual(60);
  });

  it('publishes schema changes for the SSE stream of that session only', async () => {
    const b = browser();
    const { body } = await b.start().expect(201);
    const bus = app.get(SessionEventBus);
    const received = firstValueFrom(bus.stream(body.id));

    await b.run('create table notified (id int)');

    expect(await received).toMatchObject({
      type: 'schema-changed',
      changes: [{ type: 'table-created', table: { name: 'notified' } }],
    });
  });
});
