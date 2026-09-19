export interface SqlField {
  readonly name: string;
  readonly dataTypeId: number;
}

export interface SqlQueryResult<Row> {
  readonly rows: Row[];
  readonly fields: readonly SqlField[];
}

/**
 * The query surface shared by every engine SQLScope talks to: PGlite in the browser (T0)
 * and PostgreSQL on the server (T1/T2). Code written against this interface runs unchanged
 * on both — see ADR 0001.
 *
 * Contract:
 * - `query` runs exactly one statement.
 * - All calls go through the same database session, so they observe the session's own
 *   uncommitted changes. Server adapters therefore wrap a single connection, never a pool.
 */
export interface SqlExecutor {
  query<Row extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}
