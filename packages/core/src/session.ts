import type { SqlExecutor } from './executor.js';

export interface ResultLimits {
  /** Rows kept per statement; the rest are discarded, never materialised on the server. */
  readonly maxRows: number;
  /** Approximate size of the kept values, in UTF-16 code units. */
  readonly maxBytes: number;
}

export interface OutputColumn {
  readonly name: string;
  readonly typeId: number;
}

/** What one user statement produced, with every value in PostgreSQL's text format. */
export interface StatementOutput {
  /**
   * First word of the command tag: `SELECT`, `INSERT`, `CREATE`, ... `null` when the
   * output was truncated: the server only sends the tag once a statement runs to completion.
   */
  readonly command: string | null;
  /**
   * Count carried by the command tag (rows returned by `SELECT`, affected by `INSERT`,
   * ...). `null` for commands without one, and when the output was truncated.
   */
  readonly rowCount: number | null;
  readonly columns: readonly OutputColumn[];
  /** Positional, not keyed by name: `select 1 as a, 2 as a` is valid SQL. */
  readonly rows: readonly (readonly (string | null)[])[];
  /** Why rows were cut short, if they were. */
  readonly truncated: 'rows' | 'bytes' | null;
}

/**
 * A database session that can run the SQL a user typed.
 *
 * `execute` returns values exactly as PostgreSQL renders them — `numeric` keeps its
 * precision, `timestamptz` keeps its offset — so that what the user sees is what the
 * database said, identical on every engine. `query` (inherited) keeps parsed values for
 * SQLScope's own catalog queries.
 */
export interface SqlSession extends SqlExecutor {
  execute(sql: string, limits: ResultLimits): Promise<StatementOutput>;
}

/** Error reported by the PostgreSQL server (both node-postgres and PGlite share this shape). */
export interface DatabaseError {
  readonly message: string;
  /** SQLSTATE, e.g. `42P01` for an undefined table. */
  readonly code: string;
  /** 1-based character offset into the statement, when the server points at a token. */
  readonly position: number | null;
  readonly detail: string | null;
  readonly hint: string | null;
}

/** Recognises a server error; anything else (network, bugs) is not the user's to see. */
export function asDatabaseError(error: unknown): DatabaseError | null {
  if (!(error instanceof Error)) return null;
  const e = error as Error & Record<string, unknown>;
  if (typeof e.code !== 'string' || !/^[0-9A-Z]{5}$/.test(e.code)) return null;
  const position = typeof e.position === 'string' ? Number.parseInt(e.position, 10) : NaN;
  return {
    message: e.message,
    code: e.code,
    position: Number.isFinite(position) ? position : null,
    detail: typeof e.detail === 'string' ? e.detail : null,
    hint: typeof e.hint === 'string' ? e.hint : null,
  };
}

/** Applies the truncation rule of `StatementOutput` identically for every engine. */
export function completeOutput(
  collected: RowCollector,
  columns: readonly OutputColumn[],
  command: string | null | undefined,
  rowCount: number | null | undefined,
): StatementOutput {
  const truncated = collected.truncated;
  return {
    command: truncated ? null : (command ?? null),
    rowCount: truncated ? null : (rowCount ?? null),
    columns,
    rows: collected.rows,
    truncated,
  };
}

/**
 * Accumulates rows until a limit is hit. Shared by the adapters so that both engines
 * truncate at exactly the same point.
 */
export class RowCollector {
  readonly rows: (string | null)[][] = [];
  truncated: 'rows' | 'bytes' | null = null;
  private size = 0;

  constructor(private readonly limits: ResultLimits) {}

  /** Returns `false` once no further rows should be read. */
  add(row: (string | null)[]): boolean {
    if (this.truncated) return false;
    if (this.rows.length >= this.limits.maxRows) {
      this.truncated = 'rows';
      return false;
    }
    const size = row.reduce((sum, value) => sum + (value?.length ?? 0) + 1, 0);
    if (this.size + size > this.limits.maxBytes && this.rows.length > 0) {
      this.truncated = 'bytes';
      return false;
    }
    this.size += size;
    this.rows.push(row);
    return true;
  }
}
