/**
 * Lab only: an editable copy of the Live agents wall (src/pages/LiveAgents.tsx).
 *
 * This is where the wall's layout and behavior are customized. It gets its
 * data through injection (a fake `fetch` and the tile feeds the lab builds),
 * and its timing and layout from the lab panel; it never touches the real API,
 * `thinker.liveWindows` or the shell's window manager. Decisions taken here are
 * ported by hand to the official page, with its tests.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { platformIcon } from 'thinker-shared';
import Select, { type SelectOption } from '../../components/Select.js';
import { ThemedIcon } from '../../components/setup-ui.js';
import { cx } from '../../components/ui.js';
import LiveSessionWindow from '../../components/live-session/LiveSessionWindow.js';
import { LiveDot } from '../../components/live-session/WatchLiveButton.js';
import type { LiveTab, LiveWindowPrefs } from '../../components/live-session/live-windows-store.js';
import { t } from '../../i18n/index.js';
import type { SessionSummary } from '../../services/api/sessions.js';
import type { LiveSessionFeed } from '../../services/live-session-feed.js';

const WALL_LIMIT = '100';

export interface WallLayout {
  /** Minimum tile width, px (auto-fill grid). */
  minTileWidth: number;
  /** Fixed column count; 0 fills the row with `minTileWidth` tiles. */
  columns: number;
  /** Tile height in the full view, px. */
  tileHeight: number;
  /** Tab a new tile opens on. */
  defaultTab: LiveTab;
  /** New tiles open in the short view. */
  compact: boolean;
  showReplayBar: boolean;
}

export interface WallTiming {
  pollMs: number;
  /** How long an ended tile stays before it closes by itself. */
  graceMs: number;
  /** A tile whose session was busy this recently keeps its slot. */
  settleMs: number;
  /** A tile the user scrolled, clicked or typed in this recently keeps its slot. */
  touchMs: number;
}

export const DEFAULT_LAYOUT: WallLayout = {
  minTileWidth: 440,
  columns: 0,
  tileHeight: 440,
  defaultTab: 'chat',
  compact: false,
  showReplayBar: true,
};

export const DEFAULT_TIMING: WallTiming = {
  pollMs: 5_000,
  graceMs: 60_000,
  settleMs: 10_000,
  touchMs: 30_000,
};

export interface WallStats {
  /** Sessions the last poll returned. */
  running: number;
  /** Live (non-ended) tiles. */
  shown: number;
  /** Running sessions without a tile (connection cap). */
  waiting: number;
  /** Ended tiles still on screen (grace period or pinned). */
  ended: number;
}

export interface WallTile {
  id: string;
  agentName: string | null;
  endedAt: number | null;
  pinned: boolean;
  prefs: LiveWindowPrefs;
  addedAt: number;
  busyAt: number | null;
}

export type WallSession = Pick<SessionSummary, 'id' | 'agent_name' | 'in_flight' | 'last_at'>;

export interface ReconcileOptions {
  dismissed: ReadonlySet<string>;
  now: number;
  graceMs: number;
  /** Running (non-ended) tiles at once; Infinity for no cap. */
  maxTiles: number;
  settleMs: number;
  touchMs: number;
  touchedAt?: ReadonlyMap<string, number>;
  /** Prefs of a new tile. */
  newPrefs?: LiveWindowPrefs;
}

function byPriority(a: WallSession, b: WallSession): number {
  const busy = Number(b.in_flight > 0) - Number(a.in_flight > 0);
  return busy || Date.parse(b.last_at) - Date.parse(a.last_at);
}

/** Same rules as the official `reconcileWall`, with the timings as options. */
export function reconcileWall(
  prev: WallTile[],
  running: WallSession[],
  opts: ReconcileOptions,
): WallTile[] {
  const { dismissed, now, graceMs, maxTiles, settleMs, touchMs } = opts;
  const touchedAt = opts.touchedAt ?? new Map<string, number>();
  const live = new Map(running.map((s) => [s.id, s]));

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

  const free = () => maxTiles - next.filter(runningTile).length;
  const settled = (t: WallTile) =>
    !t.pinned &&
    runningTile(t) &&
    !wanted.has(t.id) &&
    (live.get(t.id)?.in_flight ?? 0) === 0 &&
    now - Math.max(t.busyAt ?? 0, t.addedAt) >= settleMs &&
    now - (touchedAt.get(t.id) ?? -Infinity) >= touchMs;
  const releasable = next
    .filter(settled)
    .sort((a, b) => byPriority(live.get(a.id)!, live.get(b.id)!))
    .reverse();
  const toRelease = Math.max(0, waiting.length - Math.max(0, free()));
  if (toRelease > 0) {
    const gone = new Set(releasable.slice(0, toRelease).map((t) => t.id));
    next = next.filter((t) => !gone.has(t.id));
  }

  for (const s of waiting) {
    if (free() <= 0) break;
    next.push({
      id: s.id,
      agentName: s.agent_name,
      endedAt: null,
      pinned: false,
      prefs: { ...(opts.newPrefs ?? {}) },
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

async function getJson<T>(fetchImpl: typeof fetch, path: string): Promise<T> {
  const res = await fetchImpl(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export default function LiveAgentsWall({
  fetch: fetchImpl,
  createFeed,
  maxTiles,
  layout,
  timing,
  onStats,
}: {
  /** Injected backend (the lab's fake fetch). */
  fetch: typeof fetch;
  createFeed: (sessionId: string) => LiveSessionFeed;
  /** Tiles open at once; Infinity for no cap. */
  maxTiles: number;
  layout: WallLayout;
  timing: WallTiming;
  onStats?: (stats: WallStats) => void;
}) {
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
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;
  const newPrefs = useMemo<LiveWindowPrefs>(
    () => ({ tab: layout.defaultTab, ...(layout.compact ? { mode: 'compact' as const } : {}) }),
    [layout.defaultTab, layout.compact],
  );
  const optsRef = useRef({ maxTiles, timing, newPrefs });
  optsRef.current = { maxTiles, timing, newPrefs };

  // Agents for the harness filter (refreshed: the fleet grows and shrinks).
  useEffect(() => {
    let alive = true;
    const load = () =>
      getJson<{ agents?: AgentOption[] }>(fetchRef.current, '/api/v1/agents')
        .then((data) => {
          if (alive) setAgents(data.agents ?? []);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
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
        const q = new URLSearchParams({ running: 'true', range: '24h', limit: WALL_LIMIT });
        if (agent) q.set('agent_name', agent);
        const res = await getJson<{ items?: SessionSummary[] }>(
          fetchRef.current,
          `/api/v1/sessions?${q}`,
        );
        if (!alive) return;
        const items = res.items ?? [];
        const ids = new Set(items.map((s) => s.id));
        for (const id of dismissed.current) if (!ids.has(id)) dismissed.current.delete(id);
        const o = optsRef.current;
        setTiles((prev) =>
          reconcileWall(prev, items, {
            dismissed: dismissed.current,
            now: Date.now(),
            maxTiles: o.maxTiles,
            graceMs: o.timing.graceMs,
            settleMs: o.timing.settleMs,
            touchMs: o.timing.touchMs,
            touchedAt: touchedAt.current,
            newPrefs: o.newPrefs,
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
    const timer = setInterval(() => void poll(), Math.max(250, timing.pollMs));
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // A cap or timing change re-polls right away.
  }, [agent, maxTiles, timing.pollMs, timing.graceMs, timing.settleMs, timing.touchMs]);

  // Layout knobs that live in the tile prefs apply to the open tiles too.
  useEffect(() => {
    setTiles((prev) =>
      prev.map((tile) => ({
        ...tile,
        prefs: {
          ...tile.prefs,
          tab: newPrefs.tab,
          mode: newPrefs.mode ?? 'normal',
          ...(newPrefs.mode === 'compact' ? { maximized: false } : {}),
        },
      })),
    );
  }, [newPrefs]);

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
        if (tile.id !== id)
          return patch.maximized && tile.prefs.maximized
            ? { ...tile, prefs: { ...tile.prefs, maximized: false } }
            : tile;
        return { ...tile, prefs: { ...tile.prefs, ...patch } };
      }),
    );
  }, []);

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
  const endedTiles = tiles.length - shownRunning;
  const waiting = Math.max(0, runningTotal - shownRunning - dismissed.current.size);
  const budgetLabel = Number.isFinite(maxTiles) ? maxTiles : '∞';

  useEffect(() => {
    onStats?.({ running: runningTotal, shown: shownRunning, waiting, ended: endedTiles });
  }, [onStats, runningTotal, shownRunning, waiting, endedTiles]);

  const gridStyle: CSSProperties = {
    gridTemplateColumns:
      layout.columns > 0
        ? `repeat(${layout.columns}, minmax(0, 1fr))`
        : `repeat(auto-fill, minmax(min(100%, ${layout.minTileWidth}px), 1fr))`,
    ['--lab-tile-h' as string]: `${layout.tileHeight}px`,
  };

  return (
    <section className="flex min-h-full flex-col bg-bg text-ink">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-elev px-4 py-3">
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
          <LiveDot />
          {t('sessions.wall.title')}
        </h2>
        <span className="text-sm text-muted" aria-live="polite">
          {t('sessions.wall.count', { count: Math.max(runningTotal, shownRunning) })}
        </span>
        {waiting > 0 ? (
          <span
            className="text-sm text-muted"
            title={t('sessions.wall.waitingHint', { max: budgetLabel })}
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
        <div
          className={cx(
            'grid items-start gap-3 p-3',
            // Tile height and the replay bar are layout knobs over the official
            // window component (it fixes them): overridden from here.
            '[&_[role=region]:not(.fixed):not(.h-auto)]:!h-[var(--lab-tile-h)]',
            !layout.showReplayBar && '[&_[role=region]>div.border-t.bg-s2:last-child]:hidden',
          )}
          style={gridStyle}
        >
          {tiles.map((tile) => {
            const feed = feeds.current.get(tile.id);
            if (!feed) return null;
            const ended = tile.endedAt != null;
            return (
              <div
                key={tile.id}
                className={cx(ended && !tile.pinned && 'opacity-70')}
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
    </section>
  );
}

const noop = () => undefined;
