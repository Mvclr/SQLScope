/**
 * libpg_query reports positions in two different units, neither of which is a JavaScript
 * string index:
 *
 * - statement boundaries (`stmt_location`, `stmt_len`) are UTF-8 byte offsets;
 * - syntax error cursors are code point offsets.
 *
 * Both diverge from UTF-16 indices as soon as the SQL contains non-ASCII text — `'João'`
 * shifts every later byte offset, an emoji shifts every later code point offset. This maps
 * both units back to indices usable with `String.prototype.slice` and the editor.
 */
export interface PositionMap {
  readonly byteLength: number;
  fromByteOffset(offset: number): number;
  fromCodePointOffset(offset: number): number;
}

export function createPositionMap(sql: string): PositionMap {
  const byteToIndex: number[] = [];
  const codePointToIndex: number[] = [];
  let index = 0;

  for (const char of sql) {
    const codePoint = char.codePointAt(0) ?? 0;
    const bytes = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    for (let i = 0; i < bytes; i++) byteToIndex.push(index);
    codePointToIndex.push(index);
    index += char.length;
  }
  byteToIndex.push(index);
  codePointToIndex.push(index);

  const lookup = (table: number[], offset: number) =>
    table[Math.min(Math.max(offset, 0), table.length - 1)] ?? sql.length;

  return {
    byteLength: byteToIndex.length - 1,
    fromByteOffset: (offset) => lookup(byteToIndex, offset),
    fromCodePointOffset: (offset) => lookup(codePointToIndex, offset),
  };
}
