import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { introspect, readPrivileges } from '@sqlscope/core';
import { pgliteExecutor } from '@sqlscope/core/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze, analyzeDatabase, rules, type Report } from '../src/index.js';

let template: PGlite;

beforeAll(async () => {
  template = await PGlite.create();
}, 60_000);

afterAll(async () => {
  await template?.close();
});

async function reportFor(...statements: string[]): Promise<Report> {
  const db: PGliteInterface = await template.clone();
  try {
    for (const statement of statements) await db.exec(statement);
    return await analyzeDatabase(pgliteExecutor(db));
  } finally {
    await db.close();
  }
}

const ids = (report: Report) => report.findings.map((f) => f.ruleId);
const subjectsOf = (report: Report, ruleId: string) =>
  report.findings.filter((f) => f.ruleId === ruleId).map((f) => f.subject);

describe('rules', () => {
  it('every rule has a distinct id and says what to do', () => {
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    for (const rule of rules) {
      expect(rule.recommendation.length).toBeGreaterThan(40);
      expect(rule.name).not.toBe('');
    }
  });

  it('finds the problems of a deliberately careless schema', async () => {
    const report = await reportFor(
      `create table users (id int primary key, password text)`,
      `create table documents (id int, organization_id int)`,
      `create table posts (id int primary key, user_id int references users (id))`,
      `create table audit (id int primary key, organization_id int)`,
      `alter table audit enable row level security`,
      `grant select, truncate on users to public`,
      `grant create on schema public to public`,
    );

    expect(new Set(ids(report))).toEqual(
      new Set([
        'DB-SCHEMA-001', // documents has no primary key
        'DB-PERF-001', // posts.user_id is a foreign key with no index
        'DB-SEC-001', // documents has organization_id and no RLS
        'DB-SEC-002', // audit has RLS enabled and no policy
        'DB-SEC-003', // audit RLS does not apply to the owner
        'DB-SEC-004', // users.password is plain text
        'DB-SEC-005', // users is granted to PUBLIC
        'DB-SEC-006', // anyone can create objects in the public schema
        'DB-SEC-007', // PUBLIC got TRUNCATE
        'DB-SEC-008', // the login role of this database is a superuser
      ]),
    );
    expect(subjectsOf(report, 'DB-SCHEMA-001')).toEqual(['documents']);
    expect(subjectsOf(report, 'DB-SEC-001')).toEqual(['documents']);
    expect(subjectsOf(report, 'DB-SEC-004')).toEqual(['users.password']);
  });

  it('is quiet about a schema that does the right things', async () => {
    const report = await reportFor(
      `create table users (id int primary key, password_hash bytea not null)`,
      `create table documents (id int primary key, organization_id int not null)`,
      `alter table documents enable row level security`,
      `alter table documents force row level security`,
      `create policy tenant on documents using (organization_id > 0)`,
      `create table posts (id int primary key, user_id int references users (id))`,
      `create index posts_user_id on posts (user_id)`,
    );

    // Only the rule about this database's own superuser login role remains.
    expect(new Set(ids(report))).toEqual(new Set(['DB-SEC-008']));
    expect(report.checks.filter((c) => c.status === 'pass').length).toBeGreaterThan(8);
  });

  it('sees a composite foreign key as indexed only when it leads the index', async () => {
    const report = await reportFor(
      `create table parent (a int, b int, primary key (a, b))`,
      `create table child_ok (a int, b int, x int, foreign key (a, b) references parent (a, b))`,
      `create index child_ok_ab on child_ok (a, b, x)`,
      `create table child_bad (a int, b int, x int, foreign key (a, b) references parent (a, b))`,
      `create index child_bad_xa on child_bad (x, a, b)`,
    );

    expect(subjectsOf(report, 'DB-PERF-001')).toEqual(['child_bad (a, b)']);
  });

  it('flags two indexes that do the same job', async () => {
    const report = await reportFor(
      `create table t (id int primary key, email text)`,
      `create index t_email_a on t (email)`,
      `create index t_email_b on t (email)`,
    );

    expect(subjectsOf(report, 'DB-PERF-002')).toEqual(['t']);
  });

  it('orders findings by severity and counts them', async () => {
    const report = await reportFor(
      `create table users (id int primary key, token text)`,
      `grant select on users to public`,
    );

    const severities = report.findings.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort(bySeverity));
    expect(report.counts.critical).toBe(1); // the grant to PUBLIC
    expect(report.counts.high).toBeGreaterThanOrEqual(1); // the token column
  });
});

describe('analyze without privileges', () => {
  it('skips the rules that need them instead of passing them', async () => {
    const db: PGliteInterface = await template.clone();
    try {
      await db.exec('create table documents (id int, organization_id int)');
      const snapshot = await introspect(pgliteExecutor(db));

      const report = analyze({ snapshot, privileges: null });

      const skipped = report.checks.filter((c) => c.status === 'skipped').map((c) => c.rule.id);
      expect(skipped).toEqual(rules.filter((r) => r.needsPrivileges).map((r) => r.id));
      // Rules that only look at the schema still run.
      expect(ids(report)).toContain('DB-SEC-001');
    } finally {
      await db.close();
    }
  });

  it('reads the same schema with privileges and finds strictly more', async () => {
    const db: PGliteInterface = await template.clone();
    try {
      await db.exec('create table users (id int primary key); grant select on users to public');
      const executor = pgliteExecutor(db);
      const [snapshot, privileges] = [await introspect(executor), await readPrivileges(executor)];

      const without = analyze({ snapshot, privileges: null });
      const with_ = analyze({ snapshot, privileges });

      expect(ids(without)).not.toContain('DB-SEC-005');
      expect(ids(with_)).toContain('DB-SEC-005');
    } finally {
      await db.close();
    }
  });
});

const order = { critical: 0, high: 1, warning: 2, info: 3 } as const;
const bySeverity = (a: keyof typeof order, b: keyof typeof order) => order[a] - order[b];

describe('privileged roles', () => {
  it('ignores roles of the hosting cluster that have nothing to do with this database', async () => {
    // Stands for the roles a managed sandbox runs under: powerful, but not the user's.
    const report = await reportFor(
      `create role infra_admin login createdb createrole`,
      `create table t (id int primary key)`,
    );

    expect(subjectsOf(report, 'DB-SEC-008')).not.toContain('infra_admin');
  });

  it('reports one that owns or was granted something here', async () => {
    const report = await reportFor(
      `create role app_admin login createdb`,
      `create table t (id int primary key)`,
      `grant select on t to app_admin`,
    );

    expect(subjectsOf(report, 'DB-SEC-008')).toContain('app_admin');
  });
});
