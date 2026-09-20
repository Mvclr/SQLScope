import type { Node } from '@pgsql/types';
import { err, ok, type Result } from '@sqlscope/core';
import { fingerprintSync, hasSqlDetails, loadModule, parseSync } from 'libpg-query';
import { classify, type Classification } from './classify.js';
import { createPositionMap } from './positions.js';

export interface Statement extends Classification {
  /** Statement source without the terminating `;` or surrounding whitespace. */
  readonly text: string;
  /** UTF-16 index into the script where `text` starts. */
  readonly start: number;
  /** UTF-16 index into the script just past the end of `text`. */
  readonly end: number;
  readonly ast: Node;
}

export interface SqlSyntaxError {
  readonly message: string;
  /** UTF-16 index into the script, or `null` when the parser reports no position. */
  readonly position: number | null;
}

let loading: Promise<void> | undefined;

/** Loads the WebAssembly parser. Must resolve before `parseScript` is called. */
export function loadParser(): Promise<void> {
  loading ??= loadModule();
  return loading;
}

/**
 * Splits a script into statements and classifies each one, using PostgreSQL's own
 * grammar. A syntax error anywhere fails the whole script, as PostgreSQL itself would.
 */
export function parseScript(sql: string): Result<Statement[], SqlSyntaxError> {
  if (sql.trim() === '') return ok([]);

  let parsed;
  try {
    parsed = parseSync(sql);
  } catch (error) {
    if (!hasSqlDetails(error) || !error.sqlDetails) throw error;
    const cursor = error.sqlDetails.cursorPosition;
    return err({
      message: error.sqlDetails.message,
      position: cursor >= 0 ? createPositionMap(sql).fromCodePointOffset(cursor) : null,
    });
  }

  const positions = createPositionMap(sql);
  const statements = (parsed.stmts ?? []).flatMap((raw): Statement[] => {
    if (!raw.stmt) return [];
    const startByte = raw.stmt_location ?? 0;
    const endByte = raw.stmt_len ? startByte + raw.stmt_len : positions.byteLength;
    const { text, start, end } = trim(
      sql,
      positions.fromByteOffset(startByte),
      positions.fromByteOffset(endByte),
    );
    return [{ ...classify(raw.stmt), text, start, end, ast: raw.stmt }];
  });

  return ok(statements);
}

function trim(sql: string, start: number, end: number) {
  while (start < end && /\s/.test(sql[start] ?? '')) start++;
  while (end > start && /\s/.test(sql[end - 1] ?? '')) end--;
  return { text: sql.slice(start, end), start, end };
}

/**
 * Stable identity of the shape of a query: two statements differing only in literals or
 * formatting share a fingerprint. Used to recognise the same query across runs — before
 * and after an index, for instance.
 */
export function fingerprint(sql: string): string {
  return fingerprintSync(sql);
}
