import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeLegacyStorageKeys } from '../../src/services/legacy-storage';

// Pre-rename builds used the upstream product name as the key prefix.
const LEGACY = 'manifest';

describe('removeLegacyStorageKeys', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('removes every legacy-prefixed key from both storages', () => {
    localStorage.setItem(`${LEGACY}.playground.recentOpen`, 'false');
    localStorage.setItem(`${LEGACY}_chart_range`, '7d');
    localStorage.setItem(`${LEGACY}:last-auth-method`, 'email');
    sessionStorage.setItem(`${LEGACY}.playground.lastRun`, 'run-1');
    sessionStorage.setItem(`${LEGACY}:chunk-reload`, '1');

    removeLegacyStorageKeys();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps Thinker keys and unrelated keys', () => {
    localStorage.setItem('thinker.playground.recentOpen', 'false');
    localStorage.setItem('thinker_chart_range', '7d');
    localStorage.setItem('theme', 'dark');
    localStorage.setItem(`${LEGACY}ation`, 'not ours to judge');

    removeLegacyStorageKeys();

    expect(localStorage.getItem('thinker.playground.recentOpen')).toBe('false');
    expect(localStorage.getItem('thinker_chart_range')).toBe('7d');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem(`${LEGACY}ation`)).toBe('not ours to judge');
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    localStorage.setItem(`${LEGACY}_chart_range`, '7d');
    expect(() => removeLegacyStorageKeys()).not.toThrow();
  });
});
