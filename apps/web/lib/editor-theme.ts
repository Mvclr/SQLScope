/**
 * Colours for the Monaco theme, read from the design tokens.
 *
 * Monaco accepts only 6- or 8-digit hex and throws on anything else, taking the editor
 * down with it. A CSS variable can be missing or shaped differently for reasons outside
 * our code — a stylesheet reloading during development, a browser extension rewriting
 * custom properties, forced-colors mode — so every value is checked and falls back to a
 * literal from the same palette.
 */

const HEX = /^#?([0-9a-f]{6}(?:[0-9a-f]{2})?)$/i;

/** Returns the hex digits without `#`, or the fallback when the value is unusable. */
export function hexOrFallback(value: string | undefined, fallback: string): string {
  const match = HEX.exec((value ?? '').trim());
  return match ? match[1]!.toLowerCase() : fallback;
}

export interface EditorPalette {
  readonly keyword: string;
  readonly string: string;
  readonly number: string;
  readonly comment: string;
  readonly background: string;
  readonly lineHighlight: string;
  readonly lineNumber: string;
}

/** Same roles as docs/DESIGN.md, in case the tokens cannot be read. */
const FALLBACK: Record<'dark' | 'light', EditorPalette> = {
  dark: {
    keyword: '3fa7a3',
    string: 'f5b544',
    number: '6ee7f0',
    comment: '5f6b77',
    background: '11161b',
    lineHighlight: '182028',
    lineNumber: '5f6b77',
  },
  light: {
    keyword: '1f7c78',
    string: 'b7791f',
    number: '0a8fa0',
    comment: '8a959f',
    background: 'ffffff',
    lineHighlight: 'eef2f5',
    lineNumber: '8a959f',
  },
};

export function editorPalette(read: (token: string) => string, dark: boolean): EditorPalette {
  const fallback = FALLBACK[dark ? 'dark' : 'light'];
  const pick = (token: string, key: keyof EditorPalette) =>
    hexOrFallback(read(token), fallback[key]);

  return {
    keyword: pick('--structure', 'keyword'),
    string: pick('--sev-warning', 'string'),
    number: pick('--accent', 'number'),
    comment: pick('--text-faint', 'comment'),
    background: pick('--surface-1', 'background'),
    lineHighlight: pick('--surface-2', 'lineHighlight'),
    lineNumber: pick('--text-faint', 'lineNumber'),
  };
}
