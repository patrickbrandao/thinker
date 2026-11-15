/**
 * Window manager for the live-session windows, mounted in the dashboard shell
 * so windows survive navigation. Up to four windows (one per session; a fifth
 * closes the oldest), cascade placement, click to front, and per-session
 * position, size, mode and tab saved in `localStorage` (`thinker.liveWindows`).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { LiveSessionFeed } from '../../services/live-session-feed.js';
import LiveSessionWindow from './LiveSessionWindow.js';
import {
  closeLiveWindow,
  focusLiveWindow,
  openLiveWindow,
  patchLiveWindowPrefs,
  readLiveWindows,
  writeLiveWindows,
  type LiveWindowPrefs,
  type LiveWindowsSnapshot,
} from './live-windows-store.js';

export interface OpenLiveSessionOptions {
  /** false opens a finished session as a replay (history only). Default true. */
  live?: boolean;
  /** Position the window at the end of this request. */
  requestId?: string;
}

export interface LiveSessionsApi {
  openLiveSession: (sessionId: string, opts?: OpenLiveSessionOptions) => void;
  closeLiveSession: (sessionId: string) => void;
  openSessionIds: string[];
}

const LiveSessionsContext = createContext<LiveSessionsApi | null>(null);

/** The window manager, or null outside the dashboard shell (e.g. /requests/:id). */
export function useLiveSessions(): LiveSessionsApi | null {
  return useContext(LiveSessionsContext);
}

export function LiveSessionWindowsProvider({
  children,
  createFeed = (id, live) => new LiveSessionFeed(id, { live }),
}: {
  children: ReactNode;
  /** Test seam: how a window's feed is built. */
  createFeed?: (sessionId: string, live: boolean) => LiveSessionFeed;
}) {
  const [snap, setSnap] = useState<LiveWindowsSnapshot>(() => readLiveWindows());
  const [focus, setFocus] = useState<Record<string, { requestId: string; nonce: number }>>({});
  const feeds = useRef(new Map<string, LiveSessionFeed>());
  // Feeds live in a ref (they are not state); this re-renders once they change.
  const [, setFeedsVersion] = useState(0);
  const createRef = useRef(createFeed);
  createRef.current = createFeed;

  // One feed per open window: created on open (or restore), disposed on close.
  useEffect(() => {
    const map = feeds.current;
    const want = new Map(snap.open.map((e) => [e.sessionId, e.live]));
    let changed = false;
    for (const [id, feed] of map) {
      if (!want.has(id) || (want.get(id) && !feed.live)) {
        feed.dispose();
        map.delete(id);
        changed = true;
      }
    }
    for (const [id, live] of want) {
      if (map.has(id)) continue;
      const feed = createRef.current(id, live);
      map.set(id, feed);
      feed.open();
      changed = true;
    }
    if (changed) setFeedsVersion((n) => n + 1);
  }, [snap.open]);

  useEffect(() => {
    const map = feeds.current;
    return () => {
      for (const feed of map.values()) feed.dispose();
      map.clear();
    };
  }, []);

  useEffect(() => writeLiveWindows(snap), [snap]);

  const openLiveSession = useCallback((sessionId: string, opts: OpenLiveSessionOptions = {}) => {
    const live = opts.live !== false;
    setSnap((prev) => {
      const existing = prev.open.find((e) => e.sessionId === sessionId);
      // A live feed already covers a replay: never downgrade an open window.
      const { next } = openLiveWindow(prev, sessionId, existing?.live ? true : live);
      // Reopening a minimized window brings it back.
      return next.prefs[sessionId]?.mode === 'minimized'
        ? patchLiveWindowPrefs(next, sessionId, { mode: 'normal' })
        : next;
    });
    const requestId = opts.requestId;
    if (requestId)
      setFocus((f) => ({
        ...f,
        [sessionId]: { requestId, nonce: (f[sessionId]?.nonce ?? 0) + 1 },
      }));
  }, []);

  const closeLiveSession = useCallback((sessionId: string) => {
    setSnap((prev) => closeLiveWindow(prev, sessionId));
    setFocus((f) => {
      if (!(sessionId in f)) return f;
      const rest = { ...f };
      delete rest[sessionId];
      return rest;
    });
  }, []);

  const focusWindow = useCallback((sessionId: string) => {
    setSnap((prev) => focusLiveWindow(prev, sessionId));
  }, []);

  const patchPrefs = useCallback((sessionId: string, patch: LiveWindowPrefs) => {
    setSnap((prev) => patchLiveWindowPrefs(prev, sessionId, patch));
  }, []);

  // Stable per-session callbacks, so the windows do not re-subscribe on every render.
  const handlers = useRef(
    new Map<
      string,
      { onPrefs: (p: LiveWindowPrefs) => void; onFocus: () => void; onClose: () => void }
    >(),
  );
  const handlersFor = (id: string) => {
    let h = handlers.current.get(id);
    if (!h) {
      h = {
        onPrefs: (p) => patchPrefs(id, p),
        onFocus: () => focusWindow(id),
        onClose: () => closeLiveSession(id),
      };
      handlers.current.set(id, h);
    }
    return h;
  };

  const openSessionIds = useMemo(() => snap.open.map((e) => e.sessionId), [snap.open]);
  const api = useMemo<LiveSessionsApi>(
    () => ({ openLiveSession, closeLiveSession, openSessionIds }),
    [openLiveSession, closeLiveSession, openSessionIds],
  );

  return (
    <LiveSessionsContext.Provider value={api}>
      {children}
      {/* Stable DOM order (moving nodes would reset their scroll); stacking comes from z. */}
      {snap.open.map((e) => {
        const feed = feeds.current.get(e.sessionId);
        if (!feed) return null;
        const h = handlersFor(e.sessionId);
        return (
          <LiveSessionWindow
            key={`${e.sessionId}:${feed.live ? 'live' : 'replay'}`}
            feed={feed}
            slot={e.slot}
            z={Math.max(0, snap.stack.indexOf(e.sessionId))}
            prefs={snap.prefs[e.sessionId] ?? {}}
            onPrefs={h.onPrefs}
            onFocus={h.onFocus}
            onClose={h.onClose}
            focusRequestId={focus[e.sessionId]?.requestId ?? null}
            focusNonce={focus[e.sessionId]?.nonce ?? 0}
          />
        );
      })}
    </LiveSessionsContext.Provider>
  );
}
