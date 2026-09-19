import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { pgliteSession } from '@sqlscope/core/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkAnswer, type OpenVariant } from '../src/check.js';
import { findScenario, scenarios, VARIANTS, type Scenario } from '../src/index.js';

// One PGlite per scenario with the schema applied; each variant is a clone of it.
const templates = new Map<string, PGlite>();

beforeAll(async () => {
  for (const scenario of scenarios) {
    const db = await PGlite.create();
    await db.exec(scenario.schema);
    templates.set(scenario.id, db);
  }
}, 120_000);

afterAll(async () => {
  for (const db of templates.values()) await db.close();
});

const opener =
  (scenario: Scenario): OpenVariant =>
  async (variant) => {
    const db: PGliteInterface = await templates.get(scenario.id)!.clone();
    await db.exec(scenario.seed(variant));
    return { session: pgliteSession(db), close: () => db.close() };
  };

async function rowsOf(scenario: Scenario, variant: number, sql: string) {
  const db = await opener(scenario)(variant);
  try {
    return (await db.session.execute(sql, { maxRows: 10_000, maxBytes: 10_000_000 })).rows;
  } finally {
    await db.close();
  }
}

describe.each(scenarios.map((s) => [s.title, s] as const))('scenario: %s', (_, scenario) => {
  it('produces the same data for a variant every time', () => {
    for (const variant of VARIANTS) expect(scenario.seed(variant)).toBe(scenario.seed(variant));
  });

  it('runs its starter query on every variant', async () => {
    for (const variant of VARIANTS) {
      expect((await rowsOf(scenario, variant, scenario.starter)).length).toBeGreaterThan(0);
    }
  });

  it('lets the learner insert rows without colliding with seeded ids', async () => {
    const table = scenario.schema.match(/create table (\w+)/)![1]!;
    const db = await opener(scenario)(0);
    try {
      const { rows } = await db.session.query<{ id: number }>(
        `select nextval(pg_get_serial_sequence('${table}', 'id'))::int as id`,
      );
      const { rows: max } = await db.session.query<{ max: number }>(
        `select max(id)::int as max from ${table}`,
      );
      expect(rows[0]!.id).toBeGreaterThan(max[0]!.max);
    } finally {
      await db.close();
    }
  });

  describe.each(scenario.challenges.map((c) => [c.title, c] as const))(
    'challenge: %s',
    (_, challenge) => {
      it('accepts its own solution', async () => {
        expect(await checkAnswer(challenge, challenge.solution, opener(scenario))).toEqual({
          status: 'correct',
        });
      });

      it('has a non-empty answer on every variant', async () => {
        for (const variant of VARIANTS) {
          expect((await rowsOf(scenario, variant, challenge.solution)).length).toBeGreaterThan(0);
        }
      });

      it('has answers that differ between variants, so they cannot be memorised', async () => {
        const answers = await Promise.all(
          VARIANTS.map(async (v) => JSON.stringify(await rowsOf(scenario, v, challenge.solution))),
        );
        expect(new Set(answers).size).toBeGreaterThan(1);
      });

      it('rejects the variant-0 answer written as constants', async () => {
        const rows = await rowsOf(scenario, 0, challenge.solution);
        const literal = (v: string | null) =>
          v === null ? 'null' : `'${v.replaceAll("'", "''")}'`;
        const hardcoded = rows
          .map((row) => `select ${row.map(literal).join(', ')}`)
          .join(' union all ');

        const verdict = await checkAnswer(challenge, hardcoded, opener(scenario));

        expect(verdict.status).toBe('incorrect');
      });
    },
  );
});

describe('checkAnswer', () => {
  const store = findScenario('loja-online')!;
  const library = findScenario('biblioteca')!;
  const challenge = (scenario: Scenario, id: string) =>
    scenario.challenges.find((c) => c.id === id)!;

  it('accepts any query that computes the right result', async () => {
    const antiJoin = `select c.name from customers c
      left join orders o on o.customer_id = c.id where o.id is null`;

    expect(
      await checkAnswer(challenge(store, 'clientes-sem-pedidos'), antiJoin, opener(store)),
    ).toEqual({ status: 'correct' });
  });

  it('explains an INNER JOIN that drops authors without books', async () => {
    const innerJoin = `select a.name, count(*) from authors a
      join books b on b.author_id = a.id group by a.name`;

    expect(
      await checkAnswer(challenge(library, 'livros-por-autor'), innerJoin, opener(library)),
    ).toMatchObject({ status: 'incorrect', reason: 'rows', variant: 0 });
  });

  it('distinguishes the right rows in the wrong order', async () => {
    const ascending = 'select name, joined_on from members order by joined_on';

    expect(
      await checkAnswer(challenge(library, 'membros-recentes'), ascending, opener(library)),
    ).toMatchObject({ status: 'incorrect', reason: 'order' });
  });

  it('ignores row order when the challenge does not ask for one', async () => {
    const sorted = 'select name, email from customers order by email desc';

    expect(await checkAnswer(challenge(store, 'clientes'), sorted, opener(store))).toEqual({
      status: 'correct',
    });
  });

  it('reports a different number of columns', async () => {
    expect(
      await checkAnswer(challenge(store, 'clientes'), 'select * from customers', opener(store)),
    ).toMatchObject({ status: 'incorrect', reason: 'columns' });
  });

  it.each([
    ['a syntax error', 'selec name from customers', /sintaxe/],
    ['more than one statement', 'select 1; select 2', /única consulta/],
    ['a statement that is not a query', 'delete from customers', /leitura/],
    ['a query that fails', 'select nome from customers', /does not exist/],
  ])('refuses %s', async (_, answer, message) => {
    const verdict = await checkAnswer(challenge(store, 'clientes'), answer, opener(store));

    expect(verdict).toMatchObject({ status: 'invalid' });
    expect(verdict.status === 'invalid' && verdict.message).toMatch(message);
  });
});

describe('answers are unambiguous', () => {
  const store = findScenario('loja-online')!;

  it.each(VARIANTS)('variant %i has a single best-selling product', async (variant) => {
    const rows = await rowsOf(
      store,
      variant,
      `select sum(quantity) from order_items group by product_id order by 1 desc limit 2`,
    );
    expect(rows[0]![0]).not.toBe(rows[1]![0]);
  });

  it.each(VARIANTS)('variant %i has no tie between category revenues', async (variant) => {
    const rows = await rowsOf(
      store,
      variant,
      `select sum(i.quantity * i.unit_price) from order_items i
       join products p on p.id = i.product_id group by p.category`,
    );
    expect(new Set(rows.map((r) => r[0])).size).toBe(rows.length);
  });
});
