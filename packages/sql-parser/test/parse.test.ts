import { beforeAll, describe, expect, it } from 'vitest';
import { loadParser, parseScript, type Statement } from '../src/index.js';

beforeAll(loadParser);

const statements = (sql: string): Statement[] => {
  const result = parseScript(sql);
  if (!result.ok) throw new Error(`unexpected syntax error: ${result.error.message}`);
  return result.value;
};

describe('parseScript — splitting', () => {
  it('returns no statements for empty, blank or comment-only input', () => {
    expect(statements('')).toEqual([]);
    expect(statements('   \n\t')).toEqual([]);
    expect(statements('-- só um comentário\n')).toEqual([]);
  });

  it('splits statements and strips separators and surrounding whitespace', () => {
    const sql = '/* a */ select 1;  -- x\n  select 2 ;;select 3';

    expect(statements(sql).map((s) => s.text)).toEqual(['select 1', 'select 2', 'select 3']);
  });

  it('reports start/end as string indices even after non-ASCII text', () => {
    const sql = "select 'João'; insert into t values ('ção');\nselect '😀'";

    for (const s of statements(sql)) {
      expect(sql.slice(s.start, s.end)).toBe(s.text);
    }
    expect(statements(sql).map((s) => s.text)).toEqual([
      "select 'João'",
      "insert into t values ('ção')",
      "select '😀'",
    ]);
  });

  it('keeps the AST of each statement', () => {
    const [statement] = statements('select id from users');

    expect(statement?.ast).toHaveProperty('SelectStmt');
  });
});

describe('parseScript — syntax errors', () => {
  it('fails the whole script with the position of the offending token', () => {
    const sql = 'select 1; select 2 frm t';
    const result = parseScript(sql);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('syntax error at or near "t"');
    expect(result.error.position).toBe(sql.lastIndexOf('t'));
  });

  it.each([
    ["select 'ção' frm t", 'accented text'],
    ["select '😀😀' frm t", 'astral-plane characters'],
  ])('points at the right index after %s (%s)', (sql) => {
    const result = parseScript(sql);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.position).toBe(sql.lastIndexOf('t'));
  });
});
