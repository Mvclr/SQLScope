import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePlan, planInsights, walk, type QueryPlan } from '../src/index.js';

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create table users (id int primary key, name text);
    create table orders (id int primary key, user_id int references users (id), total numeric(10, 2));
    insert into users select g, 'user ' || g from generate_series(1, 2000) g;
    insert into orders select g, (g % 2000) + 1, (g % 997)::numeric from generate_series(1, 20000) g;
    analyze;`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function explain(sql: string, analyze = true): Promise<QueryPlan> {
  const options = analyze ? 'analyze, buffers, format json' : 'format json';
  const { rows } = await db.query<{ 'QUERY PLAN': unknown }>(`explain (${options}) ${sql}`);
  const parsed = parsePlan(rows[0]!['QUERY PLAN']);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe('parsePlan', () => {
  it('rejects anything that is not a plan', () => {
    expect(parsePlan(null)).toMatchObject({ ok: false });
    expect(parsePlan([{ nope: 1 }])).toMatchObject({ ok: false });
  });

  it('reads an analyzed plan, its timings and its buffers', async () => {
    const plan = await explain('select * from orders where total > 900');

    expect(plan.analyzed).toBe(true);
    expect(plan.executionMs).toBeGreaterThan(0);
    expect(plan.planningMs).toBeGreaterThan(0);
    expect(plan.root).toMatchObject({
      nodeType: 'Seq Scan',
      target: 'orders',
      cost: { total: expect.any(Number) as number },
    });
    expect(plan.root.details['Filter']).toContain('total');
    expect(plan.root.actual!.rows).toBeGreaterThan(0);
    expect(plan.root.buffers!.sharedHit + plan.root.buffers!.sharedRead).toBeGreaterThan(0);
  });

  it('keeps estimates only when the plan was not analyzed', async () => {
    const plan = await explain('select * from orders', false);

    expect(plan.analyzed).toBe(false);
    expect(plan.root.actual).toBeNull();
    expect(plan.root.estimated.rows).toBeGreaterThan(0);
    expect(planInsights(plan)).toEqual([expect.objectContaining({ id: 'not-analyzed' })]);
  });

  it('reports totals across loops, not per-loop averages', async () => {
    // Forcing nested loops makes the inner node run once per outer row.
    await db.exec('set enable_hashjoin = off; set enable_mergejoin = off');
    const plan = await explain(
      'select u.name from users u join orders o on o.user_id = u.id where o.id < 300',
    );
    await db.exec('reset enable_hashjoin; reset enable_mergejoin');

    const repeated = [...walk(plan.root)].find((n) => (n.actual?.loops ?? 0) > 100);
    expect(repeated).toBeDefined();
    expect(repeated!.actual!.rows).toBeGreaterThanOrEqual(repeated!.actual!.loops);
  });

  it('splits a node own time from its children', async () => {
    const plan = await explain(
      'select u.name, count(*) from users u join orders o on o.user_id = u.id group by u.name',
    );

    const nodes = [...walk(plan.root)];
    expect(nodes.length).toBeGreaterThan(2);
    for (const node of nodes) {
      const children = node.children.reduce((sum, c) => sum + c.actual!.totalMs, 0);
      expect(node.actual!.selfMs).toBeCloseTo(Math.max(0, node.actual!.totalMs - children), 2);
    }
    const root = plan.root.actual!;
    expect(root.totalMs).toBeGreaterThanOrEqual(root.selfMs);
  });

  it('describes joins, sorts and index scans the way PostgreSQL prints them', async () => {
    const plan = await explain(
      `select u.name from users u left join orders o on o.user_id = u.id
       where u.id = 42 order by u.name`,
    );

    const nodes = [...walk(plan.root)];
    const index = nodes.find((n) => n.nodeType.includes('Index'));
    expect(index?.target).toMatch(/users_pkey on users/);
    expect(index?.details['Index Cond']).toContain('id = 42');
  });
});

describe('planInsights', () => {
  it('flags a sequential scan that throws away almost everything it reads', async () => {
    const plan = await explain('select * from orders where total = 42');

    const insights = planInsights(plan);

    expect(insights).toContainEqual(
      expect.objectContaining({ id: 'wasted-seq-scan', severity: 'high' }),
    );
  });

  it('stops flagging it once an index answers the filter', async () => {
    await db.exec('create index orders_total on orders (total)');
    try {
      const plan = await explain('select * from orders where total = 42');

      // PostgreSQL may read it through a bitmap; either way the index answers the filter.
      const usesIndex = [...walk(plan.root)].some((n) => n.target?.includes('orders_total'));
      expect(usesIndex).toBe(true);
      expect(planInsights(plan).map((i) => i.id)).not.toContain('wasted-seq-scan');
    } finally {
      await db.exec('drop index orders_total');
    }
  });

  it('points at the node where the time is spent', async () => {
    // One node does all the work here: the scan that filters 20 000 rows.
    const plan = await explain('select * from orders where total = 42');

    const insights = planInsights(plan);

    expect(insights.some((i) => i.id === 'dominant-node')).toBe(true);
  });
});
