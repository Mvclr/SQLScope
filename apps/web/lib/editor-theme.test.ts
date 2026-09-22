import { describe, expect, it } from 'vitest';
import { editorPalette, hexOrFallback } from './editor-theme';

describe('hexOrFallback', () => {
  it.each([
    ['#11161b', '11161b'],
    ['  #11161B  ', '11161b'],
    ['11161b', '11161b'],
    ['#11161bff', '11161bff'],
    // What the CSS minifier makes of #ffffff and #00000000.
    ['#fff', 'ffffff'],
    ['#0000', '00000000'],
  ])('accepts %s', (value, expected) => {
    expect(hexOrFallback(value, 'fallback')).toBe(expected);
  });

  // Typed explicitly: otherwise the entries widen to a union of tuples and the callback
  // cannot destructure them.
  it.each<[string | undefined, string]>([
    // What Monaco rejects, and what took the editor down in practice.
    ['#ffff0', 'a five-digit hex'],
    ['', 'a variable that resolved to nothing'],
    ['#', 'a variable stripped mid-reload'],
    ['rgb(17, 22, 27)', 'a non-hex colour'],
    ['var(--other)', 'an unresolved reference'],
    [undefined, 'a missing variable'],
  ])('falls back for %s (%s)', (value) => {
    expect(hexOrFallback(value, '112233')).toBe('112233');
  });
});

describe('editorPalette', () => {
  it('uses the design tokens when they are readable', () => {
    const tokens: Record<string, string> = {
      '--structure': '#3fa7a3',
      '--sev-warning': '#f5b544',
      '--accent': '#6ee7f0',
      '--text-faint': '#5f6b77',
      '--surface-1': '#11161b',
      '--surface-2': '#182028',
    };

    const palette = editorPalette((token) => tokens[token] ?? '', true);

    expect(palette).toEqual({
      keyword: '3fa7a3',
      string: 'f5b544',
      number: '6ee7f0',
      comment: '5f6b77',
      background: '11161b',
      lineHighlight: '182028',
      lineNumber: '5f6b77',
    });
  });

  it.each([true, false])('never yields a colour Monaco rejects (dark: %s)', (dark) => {
    const palette = editorPalette(() => 'rgb(17, 22, 27)', dark);

    for (const colour of Object.values(palette)) expect(colour).toMatch(/^[0-9a-f]{6}$/);
  });
});
