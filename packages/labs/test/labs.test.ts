import { PGlite } from '@electric-sql/pglite';
import { pgliteSession } from '@sqlscope/core/pglite';
import { runScript, type ScriptResult } from '@sqlscope/engine';
import { describe, expect, it } from 'vitest';
import { labs } from '../src/index.js';

const limits = { maxRows: 100, maxBytes: 1_000_000 };

/**
 * Every lab is walked from its setup to its last step, on the engine the labs run on.
 *
 * A lab is a promise in prose: run this and you will see that. The steps that teach by
 * being refused name the SQLSTATE they expect, so the promise is checked rather than
 * trusted — a lab whose SQL drifted would be worse than no lab at all.
 */
describe.each(labs)('$title', (lab) => {
  it('runs every step, and is refused exactly where it says it will be', async () => {
    const db = await PGlite.create();
    const session = pgliteSession(db);
    try {
      expect(failureOf(await runScript(session, lab.setup, { limits, previous: null }))).toBeNull();

      for (const step of lab.steps) {
        const result = await runScript(session, step.sql, { limits, previous: null });
        expect(result.syntaxError, `${step.id}: ${result.syntaxError?.message ?? ''}`).toBeNull();

        const failure = failureOf(result);
        if (step.refused === undefined) {
          expect(failure, `${step.id} should have run clean`).toBeNull();
          if (step.rows !== undefined) {
            expect(rowsOf(result), `${step.id} should end in ${step.rows} rows`).toBe(step.rows);
          }
        } else {
          expect(failure?.code, `${step.id}: ${failure?.message ?? 'nothing failed'}`).toBe(
            step.refused,
          );
        }
      }
    } finally {
      await db.close();
    }
  });
});

/** Rows the last statement returned — the number a step's text usually promises. */
function rowsOf(result: ScriptResult): number {
  const last = result.statements.at(-1);
  return last?.status === 'ok' ? last.output.rows.length : -1;
}

function failureOf(result: ScriptResult) {
  const failed = result.statements.find((statement) => statement.status === 'error');
  return failed?.status === 'error' ? failed.error : null;
}

describe('catalog', () => {
  it('has unique ids, and unique step ids within each lab', () => {
    expect(new Set(labs.map((lab) => lab.id)).size).toBe(labs.length);
    for (const lab of labs) {
      expect(new Set(lab.steps.map((step) => step.id)).size).toBe(lab.steps.length);
    }
  });
});
