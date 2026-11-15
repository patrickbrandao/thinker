/**
 * Live agents wall (/sessions/live): a full-window page, opened in its own
 * browser tab, that opens a live view for every running session and keeps
 * doing it. It polls the running sessions, adds a tile when one starts, marks
 * a tile as ended when its session leaves the running set and drops it after
 * a grace period unless pinned. Its state is its own: it never touches the
 * shell's floating windows or their saved layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { platformIcon } from 'thinker-shared';
import Select, { type SelectOption } from '../components/Select.js';
import { ThemedIcon } from '../components/setup-ui.js';
import { cx } from '../components/ui.js';
import LiveSessionWindow from '../components/live-session/LiveSessionWindow.js';
import { LiveDot } from '../components/live-session/WatchLiveButton.js';
import type { LiveWindowPrefs } from '../components/live-session/live-windows-store.js';
import { t } from '../i18n/index.js';
import { getAgents } from '../services/api.js';
import { getSessions, type SessionSummary } from '../services/api/sessions.js';
import { LiveSessionFeed } from '../services/live-session-feed.js';

export const WALL_POLL_MS = 5_000;
/** How long an ended tile stays before it closes by itself. */
export const WALL_GRACE_MS = 60_000;
const WALL_LIMIT = '100';
/**
 * Tiles open at once, each holding one live SSE connection. The backend allows
 * 20 live feeds per organization (LIVE_MAX_CONNECTIONS_PER_TENANT); 16 leaves
 * room for the dashboard's own floating windows. Further sessions wait and
 * open as tiles close.
 */
export const WALL_MAX_TILES = 16;
/**
 * Over HTTP/1.1 a browser keeps at most six connections per host (shared by
 * all its tabs, the dashboard tab included), and every
 * open EventSource holds one: more tiles would stall the page's own requests.
 */
export const WALL_MAX_TILES_HTTP1 = 3;

/** How many tiles this tab can keep live, from the protocol the page came over. */
export function wallTileBudget(): number {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const proto = nav?.nextHopProtocol ?? '';
    return /^(h2|h3)/.test(proto) ? WALL_MAX_TILES : WALL_MAX_TILES_HTTP1;
  } catch {
    return WALL_MAX_TILES_HTTP1;
  }
}

/** A tile whose session was busy this recently keeps its slot. */
export const WALL_SETTLE_MS = 10_000;
/** A tile the user scrolled, clicked or typed in this recently keeps its slot. */
export const WALL_TOUCH_MS = 30_000;

export interface WallTile {
  id: string;
  agentName: string | null;
  /** When the session left the running set (null while running). */
  endedAt: number | null;
  pinned: boolean;
  prefs: LiveWindowPrefs;
  /** When the tile opened. */
  addedAt: number;
  /** Last poll that saw a request of the session in flight. */
  busyAt: number | null;
}

export type WallSession = Pick<SessionSummary, 'id' | 'agent_name' | 'in_flight' | 'last_at'>;

export interface ReconcileOptions {
  /** Sessions the user closed: they stay closed while they keep running. */
  dismissed: ReadonlySet<string>;
  now: number;
  graceMs?: number;
  /** Running (non-ended) tiles at once. */
  maxTiles?: number;
  /** Last user interaction per tile (scroll, click, keys). */
  touchedAt?: ReadonlyMap<string, number>;
}

/** Busy sessions first, then the most recent activity. */
function byPriority(a: WallSession, b: WallSession): number {
  const busy = Number(b.in_flight > 0) - Number(a.in_flight > 0);
  return busy || Date.parse(b.last_at) - Date.parse(a.last_at);
}

/**
 * The next wall from the current running sessions.
 *
 * - A tile whose session left the running set is marked ended (its feed
 *   closes, so it holds no slot) and dropped after the grace period unless pinned.
 * - The running slots go to the top `maxTiles` sessions by priority (a request
 *   in flight, then the latest activity); pinned tiles always keep theirs.
 * - An unpinned tile that fell out of the top is released for a waiting
 *   session of higher priority, but only once it settled: no request in
 *   flight for `WALL_SETTLE_MS` (counting from when it opened) and no user
 *   interaction for `WALL_TOUCH_MS`. That keeps tiles from flapping.
 */
export function reconcileWall(
  prev: WallTile[],
  running: WallSession[],
  opts: ReconcileOptions,
): WallTile[] {
  const { dismissed, now, graceMs = WALL_GRACE_MS, maxTiles = WALL_MAX_TILES } = opts;
  const touchedAt = opts.touchedAt ?? new Map<string, number>();
  const live = new Map(running.map((s) => [s.id, s]));

  // 1. Refresh the tiles we have.
  let next: WallTile[] = [];
  for (const tile of prev) {
    const s = live.get(tile.id);
    if (s) {
      const busyAt = s.in_flight > 0 ? now : tile.busyAt;
      next.push(
        tile.endedAt == null && tile.agentName === s.agent_name && tile.busyAt === busyAt
          ? tile
          : { ...tile, endedAt: null, agentName: s.agent_name, busyAt },
      );
      continue;
    }
    const endedAt = tile.endedAt ?? now;
    if (!tile.pinned && now - endedAt >= graceMs) continue;
    next.push(tile.endedAt === endedAt ? tile : { ...tile, endedAt });
  }

  // 2. The sessions that should hold the running slots.
  const runningTile = (t: WallTile) => t.endedAt == null;
  const pinned = next.filter((t) => runningTile(t) && t.pinned).map((t) => t.id);
  const wanted = new Set(pinned);
  for (const s of [...running].sort(byPriority)) {
    if (wanted.size >= Math.max(maxTiles, pinned.length)) break;
    if (!dismissed.has(s.id)) wanted.add(s.id);
  }
  const shown = new Set(next.map((t) => t.id));
  const waiting = [...running]
    .sort(byPriority)
    .filter((s) => wanted.has(s.id) && !shown.has(s.id) && !dismissed.has(s.id));

  // 3. Release settled tiles that fell out of the top, lowest priority first.
  const free = () => maxTiles - next.filter(runningTile).length;
  const settled = (t: WallTile) =>
    !t.pinned &&
    runningTile(t) &&
    !wanted.has(t.id) &&
    (live.get(t.id)?.in_flight ?? 0) === 0 &&
    now - Math.max(t.busyAt ?? 0, t.addedAt) >= WALL_SETTLE_MS &&
    now - (touchedAt.get(t.id) ?? -Infinity) >= WALL_TOUCH_MS;
  const releasable = next
    .filter(settled)
    .sort((a, b) => byPriority(live.get(a.id)!, live.get(b.id)!))
    .reverse();
  const toRelease = Math.max(0, waiting.length - Math.max(0, free()));
  if (toRelease > 0) {
    const gone = new Set(releasable.slice(0, toRelease).map((t) => t.id));
    next = next.filter((t) => !gone.has(t.id));
  }

  // 4. Fill the free slots, highest priority first.
  for (const s of waiting) {
    if (free() <= 0) break;
    next.push({
      id: s.id,
      agentName: s.agent_name,
      endedAt: null,
      pinned: false,
      prefs: {},
      addedAt: now,
      busyAt: s.in_flight > 0 ? now : null,
    });
  }
  const same = next.length === prev.length && next.every((tile, i) => tile === prev[i]);
  return same ? prev : next;
}

interface AgentOption {
  agent_name: string;
  agent_platform?: string | null;
  agent_category?: string | null;
}

export default function LiveAgents({
  createFeed = (id) => new LiveSessionFeed(id, { live: true }),
  maxTiles,
}: {
  /** Test seam: how a tile's feed is built. */
  createFeed?: (sessionId: string) => LiveSessionFeed;
  /** Test seam: tiles open at once (default from the connection protocol). */
  maxTiles?: number;
}) {
  const [budget] = useState(() => maxTiles ?? wallTileBudget());
  const [tiles, setTiles] = useState<WallTile[]>([]);
  const [agent, setAgent] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [runningTotal, setRunningTotal] = useState(0);
  const dismissed = useRef(new Set<string>());
  const touchedAt = useRef(new Map<string, number>());
  const touch = useCallback((id: string) => touchedAt.current.set(id, Date.now()), []);
  const feeds = useRef(new Map<string, LiveSessionFeed>());
  const createRef = useRef(createFeed);
  createRef.current = createFeed;

  useEffect(() => {
    document.title = t('sessions.wall.pageTitle');
  }, []);

  useEffect(() => {
    let alive = true;
    getAgents()
      .then((data) => {
        const list = Array.isArray(data)
          ? data
          : ((data as { agents?: AgentOption[] }).agents ?? []);
        if (alive) setAgents(list as AgentOption[]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Poll the running sessions; each answer reconciles the wall.
  useEffect(() => {
    let alive = true;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const res = await getSessions({
          running: 'true',
          range: '24h',
          agent_name: agent || undefined,
          limit: WALL_LIMIT,
        });
        if (!alive) return;
        const items = res.items ?? [];
        const ids = new Set(items.map((s) => s.id));
        // A closed session that stopped may open again when it restarts.
        for (const id of dismissed.current) if (!ids.has(id)) dismissed.current.delete(id);
        setTiles((prev) =>
          reconcileWall(prev, items, {
            dismissed: dismissed.current,
            now: Date.now(),
            maxTiles: budget,
            touchedAt: touchedAt.current,
          }),
        );
        setRunningTotal(items.length);
        setLoaded(true);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), WALL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [agent, budget]);

  // One feed per tile: opened when the tile appears, closed when it goes.
  const [, setFeedsVersion] = useState(0);
  useEffect(() => {
    const map = feeds.current;
    const want = new Set(tiles.map((tile) => tile.id));
    let changed = false;
    for (const [id, feed] of map) {
      if (want.has(id)) continue;
      feed.dispose();
      map.delete(id);
      changed = true;
    }
    for (const tile of tiles) {
      const existing = map.get(tile.id);
      if (existing) {
        // An ended session frees its connection and keeps its last state on
        // screen; one that comes back reconnects.
        if (tile.endedAt != null) existing.close();
        else existing.open();
        continue;
      }
      const feed = createRef.current(tile.id);
      map.set(tile.id, feed);
      feed.open();
      changed = true;
    }
    if (changed) setFeedsVersion((n) => n + 1);
  }, [tiles]);

  useEffect(() => {
    const map = feeds.current;
    return () => {
      for (const feed of map.values()) feed.dispose();
      map.clear();
    };
  }, []);

  const patchTile = useCallback((id: string, patch: (tile: WallTile) => WallTile) => {
    setTiles((prev) => prev.map((tile) => (tile.id === id ? patch(tile) : tile)));
  }, []);

  const closeTile = useCallback((id: string) => {
    dismissed.current.add(id);
    setTiles((prev) => prev.filter((tile) => tile.id !== id));
  }, []);

  const onPrefs = useCallback((id: string, patch: LiveWindowPrefs) => {
    touchedAt.current.set(id, Date.now());
    setTiles((prev) =>
      prev.map((tile) => {
        // One maximized tile at a time.
        if (tile.id !== id)
          return patch.maximized && tile.prefs.maximized
            ? { ...tile, prefs: { ...tile.prefs, maximized: false } }
            : tile;
        return { ...tile, prefs: { ...tile.prefs, ...patch } };
      }),
    );
  }, []);

  // Escape restores a maximized tile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setTiles((prev) =>
        prev.some((tile) => tile.prefs.maximized)
          ? prev.map((tile) =>
              tile.prefs.maximized ? { ...tile, prefs: { ...tile.prefs, maximized: false } } : tile,
            )
          : prev,
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A harness change keeps only that harness's tiles.
  const changeAgent = (value: string) => {
    setAgent(value);
    if (value) setTiles((prev) => prev.filter((tile) => tile.agentName === value));
  };

  const platformOf = useMemo(() => new Map(agents.map((a) => [a.agent_name, a])), [agents]);
  const agentOptions: SelectOption[] = [
    { label: t('sessions.allHarnesses'), value: '' },
    ...agents
      .map((a) => a.agent_name)
      .sort()
      .map((name) => {
        const info = platformOf.get(name);
        const src = info?.agent_platform
          ? platformIcon(info.agent_platform, info.agent_category ?? null)
          : null;
        return {
          label: name,
          value: name,
          icon: src ? (
            <ThemedIcon src={src} size={14} className="platform-icon shrink-0 rounded-[3px]" />
          ) : null,
        };
      }),
  ];

  const shownRunning = tiles.filter((tile) => tile.endedAt == null).length;
  const waiting = Math.max(0, runningTotal - shownRunning - dismissed.current.size);

  return (
    <main className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-elev px-4 py-3">
        <h1 className="m-0 flex items-center gap-2 text-base font-semibold">
          <LiveDot />
          {t('sessions.wall.title')}
        </h1>
        <span className="text-sm text-muted" aria-live="polite">
          {t('sessions.wall.count', { count: Math.max(runningTotal, shownRunning) })}
        </span>
        {waiting > 0 ? (
          <span
            className="text-sm text-muted"
            title={t('sessions.wall.waitingHint', { max: budget })}
          >
            {t('sessions.wall.waiting', { count: waiting })}
          </span>
        ) : null}
        {failed ? <span className="text-sm text-warn">{t('sessions.wall.loadError')}</span> : null}
        <span className="flex-1" />
        <div className="w-full sm:w-52">
          <Select value={agent} onChange={changeAgent} options={agentOptions} />
        </div>
      </header>

      {loaded && tiles.length === 0 ? (
        <div className="empty m-auto">
          <h3>{t('sessions.wall.emptyTitle')}</h3>
          <p className="max-w-md text-sm">{t('sessions.wall.emptyBody')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,440px),1fr))] items-start gap-3 p-3">
          {tiles.map((tile) => {
            const feed = feeds.current.get(tile.id);
            if (!feed) return null;
            const ended = tile.endedAt != null;
            return (
              <div
                key={tile.id}
                className={cx(ended && !tile.pinned && 'opacity-70')}
                // Interaction keeps the tile in place for a while (WALL_TOUCH_MS).
                onPointerDownCapture={() => touch(tile.id)}
                onWheelCapture={() => touch(tile.id)}
                onKeyDownCapture={() => touch(tile.id)}
                onTouchMoveCapture={() => touch(tile.id)}
              >
                <LiveSessionWindow
                  tile
                  ended={ended}
                  feed={feed}
                  slot={0}
                  z={0}
                  prefs={tile.prefs}
                  onPrefs={(p) => onPrefs(tile.id, p)}
                  onFocus={noop}
                  onClose={() => closeTile(tile.id)}
                  titleExtra={
                    <>
                      {ended ? (
                        <span className="rounded bg-s3 px-1.5 py-0.5 text-[11px] font-medium text-muted">
                          {t('sessions.wall.finished')}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        title={tile.pinned ? t('sessions.wall.unpin') : t('sessions.wall.pin')}
                        aria-label={tile.pinned ? t('sessions.wall.unpin') : t('sessions.wall.pin')}
                        aria-pressed={tile.pinned}
                        onClick={() => patchTile(tile.id, (x) => ({ ...x, pinned: !x.pinned }))}
                        className={cx(
                          'rounded p-1 hover:bg-s3 hover:text-ink',
                          tile.pinned ? 'bg-s3 text-ink' : 'text-muted',
                        )}
                      >
                        {tile.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      </button>
                    </>
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

const noop = () => undefined;
