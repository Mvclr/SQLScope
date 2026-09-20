import { PGlite } from '@electric-sql/pglite';
import type { SqlSession } from '@sqlscope/core';
import { pgliteSession } from '@sqlscope/core/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeQuery, compareAnalyses, toMeasurement, type QueryAnalysis } from '../src/index.js';

const SLOW_QUERY = 'select * from orders where total = 42';

let db: PGlite;
let session: SqlSession;

beforeAll(async () => {
  db = await PGlite.create();
  session = pgliteSession(db);
  await db.exec(`
    create table orders (id int primary key, total numeric(10, 2));
    insert into orders select g, (g % 997)::numeric from generate_series(1, 20000) g;
    analyze;`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const analyze = async (sql: string, runs?: number): Promise<QueryAnalysis> => {
  const result = await analyzeQuery(session, sql, runs === undefined ? {} : { runs });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

describe('analyzeQuery', () => {
  it('measures a read-only query and describes how it reaches the data', async () => {
    const analysis = await analyze(SLOW_QUERY);

    expect(analysis.notMeasured).toBeNull();
    expect(analysis.plan.analyzed).toBe(true);
    expect(analysis.samples).toHaveLength(2); // three runs, the first discarded
    expect(analysis.medianMs).toBeGreaterThan(0);
    expect(analysis.access).toEqual(['Seq Scan em orders']);
    expect(analysis.insights.map((i) => i.id)).toContain('wasted-seq-scan');
  });

  it('estimates without executing anything that is not a read', async () => {
    const analysis = await analyze('delete from orders where id = 1');

    expect(analysis.notMeasured).toBe('not-read-only');
    expect(analysis.plan.analyzed).toBe(false);
    expect(analysis.medianMs).toBeNull();
    expect((await session.execute('select count(*) from orders', limits)).rows).toEqual([
      ['20000'],
    ]);
  });

  it('gives the same fingerprint to the same query with different literals', async () => {
    const [a, b] = await Promise.all([
      analyze('select * from orders where total = 42', 1),
      analyze('select * from orders where total = 900', 1),
    ]);

    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it.each([
    ['a script with two statements', 'select 1; select 2', 'not-single-statement'],
    ['something that does not parse', 'selec 1', 'syntax'],
  ])('refuses %s', async (_, sql, kind) => {
    const result = await analyzeQuery(session, sql);

    expect(result).toMatchObject({ ok: false, error: { kind } });
  });

  it('reports a database error instead of throwing', async () => {
    const result = await analyzeQuery(session, 'select * from nowhere');

    expect(result).toMatchObject({ ok: false, error: { kind: 'database', code: '42P01' } });
  });
});

describe('compareAnalyses', () => {
  it('shows the index changing both the access path and the time', async () => {
    const before = await analyze(SLOW_QUERY);
    await db.exec('create index orders_total on orders (total)');
    try {
      const after = await analyze(SLOW_QUERY);

      const comparison = compareAnalyses(before, after);

      expect(comparison.accessChanged).toBe(true);
      expect(after.access.join(' ')).toMatch(/orders_total/);
      expect(comparison.speedup).toBeGreaterThan(1);
      expect(comparison.deltaMs).toBeLessThan(0);
      expect(comparison.significant).toBe(true);
      // The index changes how the rows are reached, not which rows come out.
      expect(before.rows).toBe(after.rows);
    } finally {
      await db.exec('drop index orders_total');
    }
  });

  it.each([
    ['both runs are too fast to tell apart', 0.3, 0.05, 'Seq Scan em t', 'Seq Scan em t', false],
    ['the access path changed', 0.3, 0.05, 'Seq Scan em t', 'Index Scan em t_idx on t', true],
    ['the times are long enough to mean something', 40, 3, 'Seq Scan em t', 'Seq Scan em t', true],
    ['neither the time nor the plan moved', 40, 39, 'Seq Scan em t', 'Seq Scan em t', false],
  ])(
    'calls a difference significant only when it is: %s',
    (_, before, after, accessBefore, accessAfter, significant) => {
      const comparison = compareAnalyses(
        { medianMs: before, access: [accessBefore] },
        { medianMs: after, access: [accessAfter] },
      );

      expect(comparison.significant).toBe(significant);
    },
  );

  it('keeps a measurement without the plan, so storing one stays cheap', async () => {
    const analysis = await analyze(SLOW_QUERY, 1);

    const measurement = toMeasurement(analysis, 12);

    // Everything the comparison reads, and nothing else: the plan is the large part.
    expect(measurement).toEqual({
      sql: analysis.sql.slice(0, 12),
      fingerprint: analysis.fingerprint,
      at: analysis.at,
      samples: analysis.samples,
      medianMs: analysis.medianMs,
      rows: analysis.rows,
      access: analysis.access,
    });
    expect(compareAnalyses(measurement, analysis).speedup).toBe(1);
  });

  it('has nothing to compare when one side was only estimated', async () => {
    const measured = await analyze(SLOW_QUERY, 1);
    const estimated = await analyze('delete from orders where id = -1');

    expect(compareAnalyses(measured, estimated)).toMatchObject({ speedup: null, deltaMs: null });
  });
});

const limits = { maxRows: 10, maxBytes: 10_000 };
