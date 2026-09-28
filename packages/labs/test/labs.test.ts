import { PGlite } from '@electric-sql/pglite';
import { asDatabaseError } from '@sqlscope/core';
import { pgliteSession } from '@sqlscope/core/pglite';
import { runScript, type ScriptResult } from '@sqlscope/engine';
import { describe, expect, it } from 'vitest';
import { buildSearch, labs, type Lab } from '../src/index.js';

const limits = { maxRows: 100, maxBytes: 1_000_000 };

const runtimeOf = (lab: Lab) => lab.runtime ?? 'browser';
const browserLabs = labs.filter((lab) => runtimeOf(lab) === 'browser');
const sandboxLabs = labs.filter((lab) => runtimeOf(lab) === 'sandbox');

/**
 * Every lab is walked from its setup to its last step, on the engine the labs run on.
 *
 * A lab is a promise in prose: run this and you will see that. The steps that teach by
 * being refused name the SQLSTATE they expect, so the promise is checked rather than
 * trusted — a lab whose SQL drifted would be worse than no lab at all.
 */
describe.each(browserLabs)('$title', (lab) => {
  it('runs every step twice, and is refused exactly where it says it will be', async () => {
    const db = await PGlite.create();
    const session = pgliteSession(db);
    try {
      expect(failureOf(await runScript(session, lab.setup, { limits, previous: null }))).toBeNull();

      for (const step of lab.steps) {
        // Twice, with the same outcome both times. The lab invites running a step again —
        // a second press of Run, or "troque para globex e rode de novo" — and the database
        // keeps what the first run created, so a step that only works once breaks the lab.
        for (const run of ['1st run', '2nd run']) {
          const where = `${step.id} (${run})`;
          const result = await runScript(session, step.sql ?? '', { limits, previous: null });
          expect(result.syntaxError, `${where}: ${result.syntaxError?.message ?? ''}`).toBeNull();

          const failure = failureOf(result);
          if (step.refused === undefined) {
            expect(failure, `${where} should have run clean`).toBeNull();
            if (step.rows !== undefined) {
              expect(rowsOf(result), `${where} should end in ${step.rows} rows`).toBe(step.rows);
            }
          } else {
            expect(failure?.code, `${where}: ${failure?.message ?? 'nothing failed'}`).toBe(
              step.refused,
            );
          }
        }
      }
    } finally {
      await db.close();
    }
  });
});

/**
 * A sandbox lab (ADR 0010) runs on a real server, not the tab. The container seeds the
 * database as superuser and then the app connects as the unprivileged `lab` role, which is
 * where the least-privilege lesson lives. PGlite stands in for the container: create the
 * `lab` role as the manager's init does, run the seed, drop to `lab`, and drive each step
 * through the same `buildSearch` the API and the browser use.
 */
describe.each(sandboxLabs)('$title (sandbox)', (lab) => {
  it('drives the mini-app as the lab role, refused exactly where it says', async () => {
    const db = await PGlite.create();
    try {
      // Mirrors container-spec's initSql: the role exists before the seed grants to it.
      await db.exec('create role lab nosuperuser nocreaterole nocreatedb;');
      await db.exec(lab.setup);
      await db.exec('set role lab;');

      for (const step of lab.steps) {
        const query =
          step.input !== undefined
            ? buildSearch(step.input, step.mode ?? 'concatenated')
            : { text: step.sql ?? '', values: [] };
        for (const run of ['1st run', '2nd run']) {
          const where = `${step.id} (${run})`;
          const outcome = await runAsLab(db, query.text, query.values);
          if (step.refused === undefined) {
            expect(outcome.code, `${where}: ${outcome.message ?? ''}`).toBeUndefined();
            if (step.rows !== undefined) {
              expect(outcome.rows, `${where} should end in ${step.rows} rows`).toBe(step.rows);
            }
          } else {
            expect(outcome.code, `${where}: ${outcome.message ?? 'nothing failed'}`).toBe(
              step.refused,
            );
          }
        }
      }
    } finally {
      await db.close();
    }
  });
});

/** Runs one built query, mapping a database rejection to its SQLSTATE like the app would. */
async function runAsLab(db: PGlite, text: string, values: readonly string[]) {
  try {
    const result = await db.query(text, [...values]);
    return { rows: result.rows.length, code: undefined, message: undefined };
  } catch (error) {
    const dbError = asDatabaseError(error);
    if (!dbError) throw error;
    return { rows: -1, code: dbError.code, message: dbError.message };
  }
}

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
