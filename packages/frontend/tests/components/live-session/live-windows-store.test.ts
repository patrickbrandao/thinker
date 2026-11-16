import { describe, expect, it } from 'vitest';
import {
  LIVE_WINDOWS_KEY,
  closeLiveWindow,
  emptyLiveWindows,
  focusLiveWindow,
  openLiveWindow,
  patchLiveWindowPrefs,
  readLiveWindows,
  writeLiveWindows,
} from '../../../src/components/live-session/live-windows-store';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

const open = (ids: string[]) =>
  ids.reduce((s, id) => openLiveWindow(s, id, true).next, emptyLiveWindows());

describe('live windows store', () => {
  it('opens up to four windows in cascade; a fifth closes the oldest', () => {
    const four = open(['a', 'b', 'c', 'd']);
    expect(four.open.map((e) => [e.sessionId, e.slot])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
    ]);
    const { next, closed } = openLiveWindow(four, 'e', false);
    expect(closed).toEqual(['a']);
    expect(next.open.map((e) => e.sessionId)).toEqual(['b', 'c', 'd', 'e']);
    expect(next.open.at(-1)).toEqual({ sessionId: 'e', live: false, slot: 0 });
    expect(next.stack.at(-1)).toBe('e');
  });

  it('reopening a session brings its window to front without a new one', () => {
    const s = open(['a', 'b']);
    const { next, closed } = openLiveWindow(s, 'a', true);
    expect(closed).toEqual([]);
    expect(next.open.map((e) => e.sessionId)).toEqual(['a', 'b']);
    expect(next.stack).toEqual(['b', 'a']);
    expect(focusLiveWindow(next, 'b').stack).toEqual(['a', 'b']);
    expect(closeLiveWindow(next, 'a').open.map((e) => e.sessionId)).toEqual(['b']);
  });

  it('persists open windows and per-session prefs, and restores them', () => {
    const storage = memoryStorage();
    let s = open(['a', 'b']);
    s = patchLiveWindowPrefs(s, 'a', {
      x: 10,
      y: 20,
      w: 500,
      h: 400,
      mode: 'compact',
      tab: 'inspector',
    });
    s = patchLiveWindowPrefs(s, 'b', { maximized: true });
    s = closeLiveWindow(s, 'b');
    writeLiveWindows(s, storage);
    const back = readLiveWindows(storage);
    expect(back.open).toEqual([{ sessionId: 'a', live: true, slot: 0 }]);
    expect(back.stack).toEqual(['a']);
    expect(back.prefs.a).toEqual({
      x: 10,
      y: 20,
      w: 500,
      h: 400,
      mode: 'compact',
      tab: 'inspector',
    });
    // A closed session keeps its prefs for the next time it opens.
    expect(back.prefs.b).toEqual({ maximized: true });
  });

  it('drops malformed data and survives blocked storage', () => {
    const storage = memoryStorage();
    storage.setItem(
      LIVE_WINDOWS_KEY,
      JSON.stringify({
        open: [{ sessionId: 'a' }, { sessionId: 'a' }, { nope: 1 }, 'x'],
        stack: ['zzz', 'a'],
        prefs: { a: { x: 'left', mode: 'huge', tab: 'chat' } },
      }),
    );
    expect(readLiveWindows(storage)).toEqual({
      open: [{ sessionId: 'a', live: true, slot: 0 }],
      stack: ['a'],
      prefs: { a: { tab: 'chat' } },
    });
    storage.setItem(LIVE_WINDOWS_KEY, '{not json');
    expect(readLiveWindows(storage)).toEqual(emptyLiveWindows());

    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    } as unknown as Storage;
    expect(readLiveWindows(blocked)).toEqual(emptyLiveWindows());
    expect(() => writeLiveWindows(open(['a']), blocked)).not.toThrow();
  });
});
