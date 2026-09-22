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
/** The CSS minifier writes `#ffffff` as `#fff`; Monaco rejects the short form. */
const SHORT_HEX = /^#?([0-9a-f]{3,4})$/i;

/** Returns the hex digits without `#`, or the fallback when the value is unusable. */
export function hexOrFallback(value: string | undefined, fallback: string): string {
  const text = (value ?? '').trim();
  const match = HEX.exec(text);
  if (match) return match[1]!.toLowerCase();
  const short = SHORT_HEX.exec(text);
  if (short) return [...short[1]!.toLowerCase()].map((digit) => digit + digit).join('');
  return fallback;
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
    keyword: '4fbdb5',
    string: 'f5b544',
    number: '22d3ee',
    comment: '8693a9',
    background: '111826',
    lineHighlight: '182132',
    lineNumber: '8693a9',
  },
  light: {
    keyword: '0f766e',
    string: '935f00',
    number: '0e7490',
    comment: '5a6980',
    background: 'ffffff',
    lineHighlight: 'f4f6f9',
    lineNumber: '5a6980',
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
