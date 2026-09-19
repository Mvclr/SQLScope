import {
  asDatabaseError,
  diffSnapshots,
  introspect,
  type DatabaseError,
  type ResultLimits,
  type SchemaChange,
  type SchemaSnapshot,
  type SqlSession,
  type StatementOutput,
} from '@sqlscope/core';
import {
  createPositionMap,
  loadParser,
  parseScript,
  type SqlSyntaxError,
  type Statement,
  type StatementKind,
} from '@sqlscope/sql-parser';

export interface ExecutedStatement {
  /** Position of the statement within the script (UTF-16 indices). */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly kind: StatementKind;
  readonly nodeType: string;
  readonly durationMs: number;
}

export interface SucceededStatement extends ExecutedStatement {
  readonly status: 'ok';
  readonly output: StatementOutput;
}

export interface FailedStatement extends ExecutedStatement {
  readonly status: 'error';
  readonly error: StatementError;
}

export type StatementResult = SucceededStatement | FailedStatement;

export interface StatementError extends DatabaseError {
  /** Where the server pointed, as a UTF-16 index into the whole script. */
  readonly scriptPosition: number | null;
}

export interface SchemaUpdate {
  readonly snapshot: SchemaSnapshot;
  readonly changes: readonly SchemaChange[];
}

export interface ScriptResult {
  /** Set when the script does not parse; nothing was executed. */
  readonly syntaxError: SqlSyntaxError | null;
  /** Statements that ran, in order. Execution stops at the first failure. */
  readonly statements: readonly StatementResult[];
  /** Statements left unexecuted after a failure. */
  readonly skipped: number;
  /**
   * The schema after the script, when anything that ran may have changed it.
   * `null` when nothing could have changed it, or when it could not be read.
   */
  readonly schema: SchemaUpdate | null;
  /**
   * The schema may have changed but could not be read — typically because the
   * script left the session inside a failed transaction, where no query succeeds
   * until `ROLLBACK`.
   */
  readonly schemaUnknown: boolean;
}

export interface RunOptions {
  readonly limits: ResultLimits;
  /** Schema before the script, to diff against. `null` forces a fresh read. */
  readonly previous: SchemaSnapshot | null;
}

const EMPTY: SchemaSnapshot = { tables: [] };

/**
 * Runs a user script statement by statement against `session`.
 *
 * Statements run one at a time, as psql does, so each gets its own result, timing and
 * error position. The first failure stops the script; what ran before it stays in
 * effect unless the user wrapped it in a transaction.
 */
export async function runScript(
  session: SqlSession,
  sql: string,
  options: RunOptions,
): Promise<ScriptResult> {
  await loadParser();
  const parsed = parseScript(sql);
  if (!parsed.ok) {
    return {
      syntaxError: parsed.error,
      statements: [],
      skipped: 0,
      schema: null,
      schemaUnknown: false,
    };
  }

  const results: StatementResult[] = [];
  for (const statement of parsed.value) {
    const result = await runStatement(session, statement, options.limits);
    results.push(result);
    if (result.status === 'error') break;
  }

  const mayHaveChangedSchema =
    options.previous === null ||
    parsed.value.slice(0, results.length).some((statement) => statement.changesCatalog);

  const base = {
    syntaxError: null,
    statements: results,
    skipped: parsed.value.length - results.length,
  };
  if (!mayHaveChangedSchema) return { ...base, schema: null, schemaUnknown: false };

  const schema = await readSchema(session, options.previous ?? EMPTY);
  return { ...base, schema, schemaUnknown: schema === null };
}

async function runStatement(
  session: SqlSession,
  statement: Statement,
  limits: ResultLimits,
): Promise<StatementResult> {
  const meta = {
    start: statement.start,
    end: statement.end,
    text: statement.text,
    kind: statement.kind,
    nodeType: statement.nodeType,
  };
  const startedAt = performance.now();
  const elapsed = () => Math.round((performance.now() - startedAt) * 100) / 100;

  try {
    const output = await session.execute(statement.text, limits);
    return { ...meta, status: 'ok', output, durationMs: elapsed() };
  } catch (thrown) {
    const error = asDatabaseError(thrown);
    if (!error) throw thrown;
    return {
      ...meta,
      status: 'error',
      durationMs: elapsed(),
      error: { ...error, scriptPosition: toScriptPosition(statement, error.position) },
    };
  }
}

/** The server counts characters from 1 within the statement it received. */
function toScriptPosition(statement: Statement, position: number | null): number | null {
  if (position === null) return null;
  return statement.start + createPositionMap(statement.text).fromCodePointOffset(position - 1);
}

const IN_FAILED_TRANSACTION = '25P02';

async function readSchema(
  session: SqlSession,
  previous: SchemaSnapshot,
): Promise<SchemaUpdate | null> {
  try {
    const snapshot = await introspect(session);
    return { snapshot, changes: diffSnapshots(previous, snapshot) };
  } catch (thrown) {
    if (asDatabaseError(thrown)?.code === IN_FAILED_TRANSACTION) return null;
    throw thrown;
  }
}
