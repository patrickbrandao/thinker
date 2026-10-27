import { signal } from './signal.js';

/**
 * Light/dark theme. The saved choice lives in localStorage under `theme`
 * (read before paint by public/theme-init.js); no saved choice follows the
 * operating system and keeps following it while the page is open.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'theme';

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}

export const themePreference = signal<ThemePreference>(readPreference());

export function effectiveTheme(pref: ThemePreference = themePreference()): 'light' | 'dark' {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

function apply(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', effectiveTheme() === 'dark');
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  themePreference.set(pref);
  apply();
}

/** Flips between light and dark from whatever is showing now. */
export function toggleTheme(): void {
  setThemePreference(effectiveTheme() === 'dark' ? 'light' : 'dark');
}

/** Follows the OS while no explicit choice is saved. Call once at startup. */
export function watchSystemTheme(): void {
  const media =
    typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null;
  media?.addEventListener?.('change', () => {
    if (themePreference() === 'system') apply();
  });
  apply();
}
