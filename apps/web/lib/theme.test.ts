import { describe, expect, it } from 'vitest';
import {
  parsePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeScript,
  type ThemePreference,
} from './theme';

interface Page {
  readonly theme: string | undefined;
  readonly colorScheme: string | undefined;
}

/** Runs the <head> script against a stand-in for the browser. */
function runScript(stored: string | null | Error, systemDark: boolean): Page {
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const localStorage = {
    getItem(key: string) {
      if (stored instanceof Error) throw stored;
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const matchMedia = (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' && systemDark,
  });
  const document = { documentElement: root };

  new Function('localStorage', 'matchMedia', 'document', themeScript)(
    localStorage,
    matchMedia,
    document,
  );
  return { theme: root.dataset.theme, colorScheme: root.style.colorScheme };
}

describe('parsePreference', () => {
  it.each<[string | null, ThemePreference]>([
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'system'],
    [null, 'system'],
    ['', 'system'],
    ['DARK', 'system'],
    ['{"theme":"dark"}', 'system'],
  ])('reads %j as %s', (value, expected) => {
    expect(parsePreference(value)).toBe(expected);
  });
});

describe('resolveTheme', () => {
  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('themeScript', () => {
  // The script is a copy of the logic above, serialised into the page; if the two drift,
  // the page would paint one theme and then switch to another once React loads.
  it.each([
    ['light', false],
    ['light', true],
    ['dark', false],
    ['dark', true],
    [null, false],
    [null, true],
    ['garbage', true],
  ] as const)('agrees with resolveTheme for stored %j, system dark %s', (stored, systemDark) => {
    const expected = resolveTheme(parsePreference(stored), systemDark);

    expect(runScript(stored, systemDark)).toEqual({ theme: expected, colorScheme: expected });
  });

  it('follows the system when storage is blocked', () => {
    expect(runScript(new Error('SecurityError'), true).theme).toBe('dark');
    expect(runScript(new Error('SecurityError'), false).theme).toBe('light');
  });
});
