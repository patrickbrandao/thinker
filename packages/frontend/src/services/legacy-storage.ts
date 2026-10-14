/**
 * Web Storage keys written by builds from before the Thinker rename used the
 * upstream product's prefix (`<prefix>.playground.lastRun`,
 * `<prefix>_chart_range`, `<prefix>:last-auth-method`...). Nothing in them is
 * worth migrating, so they are deleted on load instead of lingering in the
 * browser.
 */
const LEGACY_KEY_RE = /^manifest[._:]/;

function purge(getStorage: () => Storage): void {
  try {
    const storage = getStorage();
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && LEGACY_KEY_RE.test(key)) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    /* storage disabled or blocked: nothing to clean */
  }
}

/** Removes every legacy-prefixed key from localStorage and sessionStorage. Never throws. */
export function removeLegacyStorageKeys(): void {
  purge(() => localStorage);
  purge(() => sessionStorage);
}
