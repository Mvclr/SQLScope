/**
 * The two ways the injection lab's mini-app turns a search field into a query. This is the
 * whole lesson as one function: the same input, one path that lets it become part of the
 * query and one that keeps it a value.
 *
 * Pure and engine-free on purpose: the API runs it against a T2 sandbox, the labs test runs
 * it against PGlite, and the browser shows its output next to the parse tree — all from the
 * one definition.
 */
export type SearchMode = 'concatenated' | 'parameterized';

export interface BuiltQuery {
  /** The SQL text the database receives. Under `parameterized`, values live outside it. */
  readonly text: string;
  readonly values: readonly string[];
}

const COLUMNS = 'id, nome, email';
const TABLE = 'usuarios';

/** Builds the search the mini-app sends for `input`, the vulnerable way or the safe way. */
export function buildSearch(input: string, mode: SearchMode): BuiltQuery {
  if (mode === 'parameterized') {
    // The value never touches the query text: it travels beside it, as $1.
    return { text: `select ${COLUMNS} from ${TABLE} where email = $1`, values: [input] };
  }
  // The vulnerable path: the input is spliced into the text, so it can stop being a value
  // and start being SQL. This is exactly what a real app does with string concatenation.
  return { text: `select ${COLUMNS} from ${TABLE} where email = '${input}'`, values: [] };
}
