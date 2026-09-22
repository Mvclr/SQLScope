/**
 * The theme after the page has loaded: the user's choice, the system's changes, other tabs.
 * Only for client components — the server cannot know what this browser prefers.
 */

import { useSyncExternalStore } from 'react';
import {
  DARK_QUERY,
  parsePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemePreference,
} from './theme';

const listeners = new Set<() => void>();
let preference: ThemePreference | undefined;
let watching = false;

function storedPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Kept in memory too: with storage blocked, the choice still holds for this page. */
const currentPreference = () => (preference ??= storedPreference());

const systemDark = () => window.matchMedia(DARK_QUERY).matches;

const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

const notify = () => listeners.forEach((listener) => listener());

function apply(theme: Theme) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return notify();

  const swap = () => {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    notify();
  };
  // A cross-fade instead of every colour snapping at once; a cut when motion is unwanted.
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still && typeof document.startViewTransition === 'function') {
    document.startViewTransition(swap);
  } else {
    swap();
  }
}

function watch() {
  if (watching) return;
  watching = true;
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (currentPreference() === 'system') apply(resolveTheme('system', systemDark()));
  });
  // Another tab changed the preference.
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    preference = parsePreference(event.newValue);
    apply(resolveTheme(preference, systemDark()));
  });
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Not remembered across visits, but still applied now.
  }
  apply(resolveTheme(next, systemDark()));
}

function subscribe(listener: () => void) {
  watch();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// A string, so React compares snapshots by value.
const snapshot = () => `${currentPreference()}:${currentTheme()}`;

export interface ThemeState {
  /** `null` until hydrated: the server cannot know what this browser prefers. */
  readonly preference: ThemePreference | null;
  readonly theme: Theme | null;
}

export function useTheme(): ThemeState {
  const value = useSyncExternalStore(subscribe, snapshot, () => null);
  if (value === null) return { preference: null, theme: null };
  const [pref, theme] = value.split(':') as [ThemePreference, Theme];
  return { preference: pref, theme };
}
