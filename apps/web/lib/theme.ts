/**
 * Light, dark, or whatever the operating system says (docs/DESIGN.md › Cor).
 *
 * The preference lives in localStorage; the theme in effect is `data-theme` on <html>,
 * which swaps every design token at once. `themeScript` runs in <head> before the first
 * paint, so a dark page never flashes light while React loads; lib/theme-client.ts
 * changes it afterwards.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sqlscope:theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Anything unexpected in storage means "follow the system". */
export function parsePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/**
 * Serialised into the page, so it cannot call anything else in this module: it repeats
 * `parsePreference` and `resolveTheme` in miniature, and lib/theme.test.ts checks that
 * both agree. It must never throw — storage can be blocked.
 */
function applyStoredTheme(key: string, query: string) {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    // Blocked storage: follow the system.
  }
  const dark = stored === 'dark' || (stored !== 'light' && matchMedia(query).matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
}

export const themeScript = `(${applyStoredTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)},${JSON.stringify(DARK_QUERY)})`;
