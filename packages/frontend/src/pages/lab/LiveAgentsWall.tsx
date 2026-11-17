/**
 * Lab only: an editable copy of the Live agents wall (src/pages/LiveAgents.tsx).
 *
 * This is where the wall's layout and behavior are customized. It gets its
 * data through injection (a fake `fetch` and the tile feeds the lab builds),
 * and its timing and layout from the lab panel; it never touches the real API,
 * `thinker.liveWindows` or the shell's window manager. Decisions taken here are
 * ported by hand to the official page, with its tests.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { ExternalLink, Pin, PinOff } from 'lucide-react';
import { platformIcon } from 'thinker-shared';
import Select, { type SelectOption } from '../../components/Select.js';
import { ThemedIcon } from '../../components/setup-ui.js';
import { cx } from '../../components/ui.js';
import LiveSessionWindow from '../../components/live-session/LiveSessionWindow.js';
import { LiveDot } from '../../components/live-session/WatchLiveButton.js';
import type { LiveTab, LiveWindowPrefs } from '../../components/live-session/live-windows-store.js';
import { t } from '../../i18n/index.js';
import type { SessionSummary } from '../../services/api/sessions.js';
import { useLiveFeed, type LiveSessionFeed } from '../../services/live-session-feed.js';
import HexLiveWindow from '../../components/live-session/HexLiveWindow.js';
import { watchPath } from './live-agents-bridge.js';
import {
  AutoCloser,
  DEFAULT_AUTO_CLOSE,
  cascadePosition,
  freeSlot,
  lastItemKind,
  resizeFrom,
  windowSize,
  type AutoCloseStatus,
  type AutoCloseTimeouts,
  type ResizeEdge,
  type Size,
} from '../../components/live-session/hex-live.js';
import '../../components/live-session/hex-live.css';

export type WallTheme = 'thinker' | 'hex';

const WALL_LIMIT = '100';

export interface WallLayout {
  /** Window width, px (the cascade windows; the name is kept from the grid). */
  minTileWidth: number;
  /** Unused by the cascade (kept so older saved settings load). */
  columns: number;
  /** Window height in the full view, px. */
  tileHeight: number;
  /** Tab a new tile opens on. */
  defaultTab: LiveTab;
  showReplayBar: boolean;
}

export interface WallTiming {
  pollMs: number;
  /** A tile whose session was busy this recently keeps its slot. */
  settleMs: number;
  /** A tile the user scrolled, clicked or typed in this recently keeps its slot. */
  touchMs: number;
}

export const DEFAULT_LAYOUT: WallLayout = {
  minTileWidth: 420,
  columns: 0,
  tileHeight: 360,
  defaultTab: 'chat',
  showReplayBar: true,
};

export const DEFAULT_TIMING: WallTiming = {
  pollMs: 5_000,
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
  hideHeader = false,
  agentFilter,
  providerFilter = '',
  onProviders,
  theme = 'thinker',
  autoClose = DEFAULT_AUTO_CLOSE,
}: {
  /** Injected backend (the lab's fake fetch). */
  fetch: typeof fetch;
  createFeed: (sessionId: string) => LiveSessionFeed;
  /** Tiles open at once; Infinity for no cap. */
  maxTiles: number;
  layout: WallLayout;
  timing: WallTiming;
  onStats?: (stats: WallStats) => void;
  /** Lab: drop the page header (the controls window shows title, counts and filter). */
  hideHeader?: boolean;
  /** Lab: harness filter controlled from outside ('' = all); overrides the header select. */
  agentFilter?: string;
  /** Lab: provider filter ('' = all), applied client-side. */
  providerFilter?: string;
  /** Lab: every provider seen on running sessions (for the provider select). */
  onProviders?: (ids: string[]) => void;
  /** Window look: the dashboard's live window or the anoma-ly-hex card. */
  theme?: WallTheme;
  /** A window closes by itself this long after its session's last item. */
  autoClose?: AutoCloseTimeouts;
}) {
  const [tiles, setTiles] = useState<WallTile[]>([]);
  const [ownAgent, setAgent] = useState('');
  const agent = agentFilter ?? ownAgent;
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [runningTotal, setRunningTotal] = useState(0);
  const dismissed = useRef(new Set<string>());
  /** Auto-closed windows: session id -> its last_at then. New activity brings it back. */
  const autoClosed = useRef(new Map<string, string>());
  const lastSeen = useRef(new Map<string, WallSession>());
  const [hiddenCount, setHiddenCount] = useState(0);
  const pollNow = useRef<() => void>(() => undefined);
  const touchedAt = useRef(new Map<string, number>());
  const touch = useCallback((id: string) => touchedAt.current.set(id, Date.now()), []);
  const feeds = useRef(new Map<string, LiveSessionFeed>());
  const createRef = useRef(createFeed);
  createRef.current = createFeed;
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;
  const newPrefs = useMemo<LiveWindowPrefs>(
    () => ({ tab: layout.defaultTab }),
    [layout.defaultTab],
  );
  const optsRef = useRef({ maxTiles, timing, newPrefs, providerFilter });
  optsRef.current = { maxTiles, timing, newPrefs, providerFilter };
  const seenProviders = useRef(new Set<string>());
  const onProvidersRef = useRef(onProviders);
  onProvidersRef.current = onProviders;

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
        const all = res.items ?? [];
        const before = seenProviders.current.size;
        for (const s of all) for (const p of s.providers ?? []) seenProviders.current.add(p);
        if (seenProviders.current.size !== before)
          onProvidersRef.current?.([...seenProviders.current].sort());
        const pf = optsRef.current.providerFilter;
        const items = pf ? all.filter((s) => (s.providers ?? []).includes(pf)) : all;
        const ids = new Set(items.map((s) => s.id));
        for (const id of dismissed.current) if (!ids.has(id)) dismissed.current.delete(id);
        lastSeen.current = new Map(items.map((s) => [s.id, s]));
        for (const [id, at] of autoClosed.current) {
          const s = lastSeen.current.get(id);
          if (!s || s.in_flight > 0 || s.last_at !== at) autoClosed.current.delete(id);
        }
        const hidden = new Set([...dismissed.current, ...autoClosed.current.keys()]);
        setHiddenCount(hidden.size);
        const o = optsRef.current;
        setTiles((prev) =>
          reconcileWall(prev, items, {
            dismissed: hidden,
            now: Date.now(),
            maxTiles: o.maxTiles,
            // Ended windows close by the auto-close rule (last item decides), not a grace.
            graceMs: Infinity,
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
    pollNow.current = () => void poll();
    const timer = setInterval(() => void poll(), Math.max(250, timing.pollMs));
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // A cap or timing change re-polls right away.
  }, [agent, maxTiles, timing.pollMs, timing.settleMs, timing.touchMs]);

  // Layout knobs that live in the tile prefs apply to the open tiles too.
  useEffect(() => {
    setTiles((prev) =>
      prev.map((tile) => ({
        ...tile,
        prefs: { ...tile.prefs, tab: newPrefs.tab },
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
    // A waiting session takes the freed slot right away.
    setTimeout(() => pollNow.current(), 0);
  }, []);

  const autoCloseTile = useCallback((id: string) => {
    const s = lastSeen.current.get(id);
    if (s) autoClosed.current.set(id, s.last_at);
    setTiles((prev) => prev.filter((tile) => tile.id !== id));
    setTimeout(() => pollNow.current(), 0);
  }, []);

  const onPrefs = useCallback((id: string, patch: LiveWindowPrefs) => {
    touchedAt.current.set(id, Date.now());
    // No maximize in the lab (the official window still offers it): "open in a new tab" instead.
    const clean = withoutMaximize(patch);
    setTiles((prev) =>
      prev.map((tile) => (tile.id === id ? { ...tile, prefs: { ...tile.prefs, ...clean } } : tile)),
    );
  }, []);

  // An external filter (lab controls window) drops the other harnesses' tiles too.
  useEffect(() => {
    if (agentFilter) setTiles((prev) => prev.filter((tile) => tile.agentName === agentFilter));
  }, [agentFilter]);
  useEffect(() => {
    pollNow.current();
  }, [providerFilter]);

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
  const waiting = Math.max(0, runningTotal - shownRunning - hiddenCount);
  const budgetLabel = Number.isFinite(maxTiles) ? maxTiles : '∞';

  useEffect(() => {
    onStats?.({ running: runningTotal, shown: shownRunning, waiting, ended: endedTiles });
  }, [onStats, runningTotal, shownRunning, waiting, endedTiles]);

  // ------------------------------------------------------------- cascade
  const layer = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const el = layer.current;
    const measure = () =>
      setArea({ w: el?.clientWidth || window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(measure) : null;
    if (ro && el) ro.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [loaded]);
  const winW = Math.max(240, Math.min(layout.minTileWidth, area.w - 2 * CASCADE_GAP));
  const winH = layout.tileHeight;
  /** Largest window: the wall's width and the viewport's height. */
  const maxSize: Size = { w: area.w, h: area.h };

  // Cascade slot per window (a closed window frees its slot for the next one).
  const slots = useRef(new Map<string, number>());
  for (const id of [...slots.current.keys()])
    if (!tiles.some((tile) => tile.id === id)) slots.current.delete(id);
  for (const tile of tiles)
    if (!slots.current.has(tile.id)) slots.current.set(tile.id, freeSlot(slots.current.values()));

  // Z-order: last is in front; new windows open on top.
  const [stack, setStack] = useState<string[]>([]);
  useEffect(() => {
    setStack((prev) => {
      const ids = new Set(tiles.map((tile) => tile.id));
      const kept = prev.filter((id) => ids.has(id));
      const added = tiles.map((tile) => tile.id).filter((id) => !kept.includes(id));
      return added.length || kept.length !== prev.length ? [...kept, ...added] : prev;
    });
  }, [tiles]);
  const toFront = useCallback(
    (id: string) =>
      setStack((prev) => (prev.at(-1) === id ? prev : [...prev.filter((x) => x !== id), id])),
    [],
  );

  const placed = tiles.map((tile) => {
    const auto = cascadePosition(slots.current.get(tile.id) ?? 0, {
      width: winW,
      height: winH,
      areaWidth: area.w,
      areaHeight: area.h,
    });
    const moved = tile.prefs.x != null && tile.prefs.y != null;
    const size = windowSize(tile.prefs, { w: winW, h: winH }, maxSize);
    return { tile, size, x: moved ? tile.prefs.x! : auto.x, y: moved ? tile.prefs.y! : auto.y };
  });
  const layerHeight = Math.max(area.h, ...placed.map((p) => p.y + p.size.h + CASCADE_GAP));
  const layerStyle: CSSProperties = { minHeight: layerHeight };

  return (
    <section
      className={cx(
        'flex min-h-full flex-col text-ink',
        theme === 'hex' ? 'lab-hex live-wall' : 'bg-bg',
      )}
    >
      <style>{hideMaximizeCss(`.${HIDE_MAXIMIZE}`)}</style>
      {hideHeader ? null : (
        <header className="flex flex-wrap items-center gap-2.5 border-b border-line bg-elev px-3 py-1">
          <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
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
          {failed ? (
            <span className="text-sm text-warn">{t('sessions.wall.loadError')}</span>
          ) : null}
          <span className="flex-1" />
          <div className="w-full sm:w-52">
            <Select value={agent} onChange={changeAgent} options={agentOptions} />
          </div>
        </header>
      )}

      {loaded && tiles.length === 0 ? (
        <div className="empty m-auto">
          <h3>{t('sessions.wall.emptyTitle')}</h3>
          <p className="max-w-md text-sm">{t('sessions.wall.emptyBody')}</p>
        </div>
      ) : (
        <div
          ref={layer}
          className={cx(
            'relative flex-1',
            // Tile height and the replay bar are layout knobs over the official
            // window component (it fixes them): overridden from here.
            '[&_[role=region]:not(.fixed):not(.h-auto)]:!h-[var(--lab-tile-h)]',
            '[&_[role=region]>div:first-child]:cursor-grab',
            // The official window's maximize button: the lab opens a tab instead.
            HIDE_MAXIMIZE,
            !layout.showReplayBar && '[&_[role=region]>div.border-t.bg-s2:last-child]:hidden',
          )}
          style={layerStyle}
        >
          {placed.map(({ tile, size, x, y }) => {
            const feed = feeds.current.get(tile.id);
            if (!feed) return null;
            const info = tile.agentName ? platformOf.get(tile.agentName) : undefined;
            return (
              <WallWindow
                key={tile.id}
                tile={tile}
                feed={feed}
                theme={theme}
                x={x}
                y={y}
                size={size}
                maxSize={maxSize}
                z={stack.indexOf(tile.id) + 1}
                layer={layer}
                autoClose={autoClose}
                iconSrc={
                  info?.agent_platform
                    ? (platformIcon(info.agent_platform, info.agent_category ?? null) ?? null)
                    : null
                }
                onFront={() => toFront(tile.id)}
                onTouch={() => touch(tile.id)}
                onMove={(nx, ny) => onPrefs(tile.id, { x: nx, y: ny })}
                onResize={(next) => onPrefs(tile.id, next)}
                onPopout={() => window.open(watchPath(tile.id), '_blank')}
                onPrefs={(patch) => onPrefs(tile.id, patch)}
                onPin={() => patchTile(tile.id, (w) => ({ ...w, pinned: !w.pinned }))}
                onClose={() => closeTile(tile.id)}
                onAutoClose={() => autoCloseTile(tile.id)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

const CASCADE_GAP = 12;

/**
 * Drops `maximized` and `mode` from a prefs patch: the lab has no maximize
 * and no short (compact) view, every window stays in the full view.
 */
export function withoutMaximize(patch: LiveWindowPrefs): LiveWindowPrefs {
  if (!('maximized' in patch) && !('mode' in patch)) return patch;
  const out = { ...patch };
  delete out.maximized;
  delete out.mode;
  return out;
}

/**
 * Hides the official window's maximize and short-view buttons (lab only).
 * The buttons have no class of their own, so they are matched by their
 * translated labels.
 */
export function hideMaximizeCss(scope: string): string {
  return ['liveSession.maximize', 'liveSession.shortView', 'liveSession.fullView']
    .map((key) => {
      const label = JSON.stringify(t(key as 'liveSession.maximize'));
      return `${scope} [role=region] button[aria-label=${label}]{display:none}`;
    })
    .join('\n');
}
export const HIDE_MAXIMIZE = 'lab-no-maximize';

/**
 * One window of the cascade: absolute position (cascade slot or where the user
 * dropped it), size (layout knob or what the user resized it to), drag by the
 * header, resize by the right edge, bottom edge and bottom-right grip, z-order,
 * and the auto-close countdown.
 */
function WallWindow({
  tile,
  feed,
  theme,
  x,
  y,
  size,
  maxSize,
  z,
  layer,
  autoClose,
  iconSrc,
  onFront,
  onTouch,
  onMove,
  onResize,
  onPrefs,
  onPin,
  onPopout,
  onClose,
  onAutoClose,
}: {
  tile: WallTile;
  feed: LiveSessionFeed;
  theme: WallTheme;
  x: number;
  y: number;
  size: Size;
  maxSize: Size;
  z: number;
  layer: RefObject<HTMLDivElement | null>;
  autoClose: AutoCloseTimeouts;
  iconSrc: string | null;
  onFront: () => void;
  onTouch: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (size: Size) => void;
  onPrefs: (patch: LiveWindowPrefs) => void;
  onPin: () => void;
  onPopout: () => void;
  onClose: () => void;
  onAutoClose: () => void;
}) {
  useLiveFeed(feed);
  const ended = tile.endedAt != null;
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [resizing, setResizing] = useState<Size | null>(null);
  const [hover, setHover] = useState(false);
  const current = resizing ?? size;

  // ----------------------------------------------------------- auto-close
  const onAutoCloseRef = useRef(onAutoClose);
  onAutoCloseRef.current = onAutoClose;
  const closer = useRef<AutoCloser | null>(null);
  // Created in the effect (StrictMode runs the cleanup once and mounts again).
  useEffect(
    () => () => {
      closer.current?.dispose();
      closer.current = null;
    },
    [],
  );
  const kind = lastItemKind(feed.state);
  const activity = feed.state.lastEventId;
  const paused = hover || drag != null || resizing != null;
  const [count, setCount] = useState<AutoCloseStatus | null>(null);
  useEffect(() => {
    closer.current ??= new AutoCloser(() => onAutoCloseRef.current());
    setCount(
      closer.current.update({ kind, activity, pinned: tile.pinned, ended, paused }, autoClose),
    );
  }, [kind, activity, tile.pinned, ended, paused, autoClose]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!count || count.paused) return;
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [count]);
  const live = closer.current?.status() ?? null;
  const closesInSec = live ? Math.max(0, Math.ceil(live.remainingMs / 1000)) : null;

  // ----------------------------------------------------------------- drag
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0) return;
    if (target.closest('button, input, select, textarea, a, .lab-resize')) return;
    if (!target.closest('.lab-hex-win__head, [role=region] > div:first-child')) return;
    const box = layer.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const dx = e.clientX - (box.left + x);
    const dy = e.clientY - (box.top + y);
    let last = { x, y };
    const move = (ev: PointerEvent) => {
      const b = layer.current?.getBoundingClientRect() ?? box;
      last = {
        x: Math.round(
          Math.min(Math.max(ev.clientX - b.left - dx, 0), Math.max(0, b.width - size.w)),
        ),
        y: Math.round(Math.max(ev.clientY - b.top - dy, 0)),
      };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (last.x !== x || last.y !== y) onMove(last.x, last.y);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // --------------------------------------------------------------- resize
  const startResize = (edge: ResizeEdge) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = size;
    const sx = e.clientX;
    const sy = e.clientY;
    let last = start;
    setResizing(start);
    const move = (ev: PointerEvent) => {
      last = resizeFrom(start, edge, ev.clientX - sx, ev.clientY - sy, maxSize);
      setResizing(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setResizing(null);
      if (last.w !== start.w || last.h !== start.h) onResize(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const at = drag ?? { x, y };
  const style: CSSProperties = {
    position: 'absolute',
    left: at.x,
    top: at.y,
    width: current.w,
    zIndex: z,
    // The Thinker window takes its height from this variable (see the layer CSS).
    ['--lab-tile-h' as string]: `${current.h}px`,
    ...(theme === 'hex' ? { height: current.h } : {}),
  };

  const countdown =
    count && live ? (
      <div className="lab-countdown" aria-hidden="true">
        <i
          key={`${activity}:${count.totalMs}:${count.paused}`}
          style={{
            transform: `scaleX(${count.remainingMs / Math.max(1, count.totalMs)})`,
            animationDuration: `${count.remainingMs}ms`,
            animationPlayState: count.paused ? 'paused' : 'running',
          }}
        />
      </div>
    ) : null;

  const popoutLabel = 'Open in a new tab';

  return (
    <div
      className={cx(
        'lab-wall-win',
        ended && !tile.pinned && 'opacity-80',
        (drag || resizing) && 'select-none',
      )}
      style={style}
      title={
        closesInSec != null
          ? `Closes by itself in ${closesInSec}s (${kind === 'answer' ? 'assistant answered' : 'waiting on a tool call'}); hover to pause, pin to keep`
          : undefined
      }
      onPointerDownCapture={() => {
        onFront();
        onTouch();
      }}
      onPointerDown={startDrag}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onWheelCapture={onTouch}
      onKeyDownCapture={onTouch}
      onTouchMoveCapture={onTouch}
    >
      {theme === 'hex' ? (
        <HexLiveWindow
          feed={feed}
          prefs={tile.prefs}
          onPrefs={onPrefs}
          onClose={onClose}
          pinned={tile.pinned}
          onPin={onPin}
          onPopout={onPopout}
          ended={ended}
          iconSrc={iconSrc}
          closesInSec={closesInSec}
        />
      ) : (
        <LiveSessionWindow
          tile
          ended={ended}
          feed={feed}
          slot={0}
          z={0}
          prefs={tile.prefs}
          onPrefs={onPrefs}
          onFocus={noop}
          onClose={onClose}
          titleExtra={
            <>
              {closesInSec != null ? (
                <span className="font-mono text-[11px] text-faint">{closesInSec}s</span>
              ) : null}
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
                onClick={onPin}
                className={cx(
                  'rounded p-1 hover:bg-s3 hover:text-ink',
                  tile.pinned ? 'bg-s3 text-ink' : 'text-muted',
                )}
              >
                {tile.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button
                type="button"
                title={popoutLabel}
                aria-label={popoutLabel}
                onClick={onPopout}
                className="rounded p-1 text-muted hover:bg-s3 hover:text-ink"
              >
                <ExternalLink size={14} />
              </button>
            </>
          }
        />
      )}
      {countdown}
      <div
        className="lab-resize lab-resize--e"
        aria-hidden="true"
        onPointerDown={startResize('e')}
      />
      <div
        className="lab-resize lab-resize--s"
        aria-hidden="true"
        onPointerDown={startResize('s')}
      />
      <div
        className="lab-resize lab-resize--se"
        title="Resize"
        aria-hidden="true"
        onPointerDown={startResize('se')}
      />
    </div>
  );
}

const noop = () => undefined;
