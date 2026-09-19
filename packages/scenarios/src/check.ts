import type { SqlSession, StatementOutput } from '@sqlscope/core';
import { loadParser, parseScript } from '@sqlscope/sql-parser';
import { runScript } from '@sqlscope/engine';
import { VARIANTS, type Challenge } from './scenario.js';

/** Opens a pristine database for one variant — never the learner's own workspace. */
export type OpenVariant = (
  variant: number,
) => Promise<{ session: SqlSession; close(): Promise<void> }>;

export type Verdict =
  | { readonly status: 'correct' }
  | {
      readonly status: 'incorrect';
      readonly reason: 'columns' | 'rows' | 'order';
      readonly message: string;
      /** Variant on which the answer first diverged. 0 is the data the learner sees. */
      readonly variant: number;
    }
  | { readonly status: 'invalid'; readonly message: string };

const limits = { maxRows: 5_000, maxBytes: 2_000_000 };

/**
 * Checks an answer by running it and the reference solution on every dataset variant
 * and comparing their output. Any query that computes the right result passes — the text
 * of the SQL does not matter, only what it returns.
 */
export async function checkAnswer(
  challenge: Challenge,
  answer: string,
  open: OpenVariant,
): Promise<Verdict> {
  await loadParser();
  const parsed = parseScript(answer);
  if (!parsed.ok) return { status: 'invalid', message: `Erro de sintaxe: ${parsed.error.message}` };
  if (parsed.value.length !== 1) {
    return { status: 'invalid', message: 'A resposta deve ser uma única consulta.' };
  }
  if (parsed.value[0]!.kind !== 'read') {
    return { status: 'invalid', message: 'A resposta deve ser uma consulta de leitura (SELECT).' };
  }

  for (const variant of VARIANTS) {
    const db = await open(variant);
    try {
      const expected = await outputOf(db.session, challenge.solution);
      if (!expected.ok) throw new Error(`Solution of ${challenge.id} failed: ${expected.message}`);
      const actual = await outputOf(db.session, answer);
      if (!actual.ok) return { status: 'invalid', message: actual.message };

      const mismatch = compare(expected.output, actual.output, challenge.ordered);
      if (mismatch) return { status: 'incorrect', variant, ...mismatch };
    } finally {
      await db.close();
    }
  }
  return { status: 'correct' };
}

type Outcome = { ok: true; output: StatementOutput } | { ok: false; message: string };

async function outputOf(session: SqlSession, sql: string): Promise<Outcome> {
  const result = await runScript(session, sql, { limits, previous: { tables: [] } });
  const statement = result.statements[0];
  if (result.syntaxError) return { ok: false, message: result.syntaxError.message };
  if (!statement) return { ok: false, message: 'Nada foi executado.' };
  if (statement.status === 'error') return { ok: false, message: statement.error.message };
  return { ok: true, output: statement.output };
}

function compare(
  expected: StatementOutput,
  actual: StatementOutput,
  ordered: boolean,
): { reason: 'columns' | 'rows' | 'order'; message: string } | null {
  if (expected.columns.length !== actual.columns.length) {
    return {
      reason: 'columns',
      message: `A consulta retorna ${actual.columns.length} coluna(s); a resposta tem ${expected.columns.length}.`,
    };
  }

  const expectedRows = expected.rows.map(key);
  const actualRows = actual.rows.map(key);

  if (!sameMultiset(expectedRows, actualRows)) {
    const count =
      expectedRows.length === actualRows.length
        ? `As ${actualRows.length} linhas retornadas não são as esperadas.`
        : `A consulta retorna ${actualRows.length} linha(s); a resposta tem ${expectedRows.length}.`;
    return { reason: 'rows', message: count };
  }

  if (ordered && expectedRows.some((row, i) => row !== actualRows[i])) {
    return { reason: 'order', message: 'As linhas estão certas, mas a ordem não.' };
  }
  return null;
}

/** Column values joined unambiguously; `null` and the string "null" stay distinct. */
const key = (row: readonly (string | null)[]) => JSON.stringify(row);

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const item of a) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of b) {
    const count = counts.get(item);
    if (!count) return false;
    counts.set(item, count - 1);
  }
  return true;
}
