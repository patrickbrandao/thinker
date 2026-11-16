/**
 * Live agents wall (/sessions/live): a full-window page, opened in its own
 * browser tab, that opens a live view for every running session and keeps
 * doing it. It polls the running sessions, adds a tile when one starts, marks
 * a tile as ended when its session leaves the running set and drops it after
 * a grace period unless pinned. Its state is its own: it never touches the
 * shell's floating windows or their saved layout.
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
import { Moon, Settings2, Sun, X } from 'lucide-react';
import { platformIcon } from 'thinker-shared';
import Select, { type SelectOption } from '../components/Select.js';
import { ThemedIcon } from '../components/setup-ui.js';
import { cx } from '../components/ui.js';
import HexLiveWindow from '../components/live-session/HexLiveWindow.js';
import '../components/live-session/hex-live.css';
import {
  AutoCloser,
  cascadePosition,
  freeSlot,
  lastItemKind,
  resizeFrom,
  windowSize,
  type AutoCloseStatus,
  type ResizeEdge,
  type Size,
} from '../components/live-session/hex-live.js';
import type { LiveTab } from '../components/live-session/live-windows-store.js';
import { PROVIDERS } from '../services/providers.js';
import { LiveDot } from '../components/live-session/WatchLiveButton.js';
import type { LiveWindowPrefs } from '../components/live-session/live-windows-store.js';
import { t } from '../i18n/index.js';
import { useSignal } from '../lib/signal.js';
import { effectiveTheme, themePreference, toggleTheme } from '../lib/theme.js';
import { getAgents } from '../services/api.js';
import { getSessions, type SessionSummary } from '../services/api/sessions.js';
import { LiveSessionFeed, useLiveFeed } from '../services/live-session-feed.js';

export const WALL_POLL_MS = 5_000;

/** Viewer preferences of the wall, kept in this browser. */
export interface WallPrefs {
  /** Size of a new window, px. */
  winW: number;
  winH: number;
  /** Tab a new window opens on. */
  defaultTab: LiveTab;
  /** Seconds a window stays after the assistant answered (0: never closes). */
  closeAfterAnswerSec: number;
  /** Seconds a window stays while the last item is a tool call (0: never closes). */
  closeAfterToolSec: number;
}

export const DEFAULT_WALL_PREFS: WallPrefs = {
  winW: 440,
  winH: 480,
  defaultTab: 'chat',
  closeAfterAnswerSec: 10,
  closeAfterToolSec: 60,
};
const PREFS_KEY = 'thinker.liveWall.prefs';
const TABS: LiveTab[] = ['chat', 'details', 'inspector'];

const clampInt = (v: unknown, min: number, max: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;

/** Saved preferences, each field checked (bad or missing ones take the default). */
export function readWallPrefs(raw: string | null): WallPrefs {
  const d = DEFAULT_WALL_PREFS;
  let o: Record<string, unknown> = {};
  try {
    o = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
  } catch {
    o = {};
  }
  return {
    winW: clampInt(o.winW, 240, 1200, d.winW),
    winH: clampInt(o.winH, 200, 1200, d.winH),
    defaultTab: TABS.includes(o.defaultTab as LiveTab) ? (o.defaultTab as LiveTab) : d.defaultTab,
    closeAfterAnswerSec: clampInt(o.closeAfterAnswerSec, 0, 3600, d.closeAfterAnswerSec),
    closeAfterToolSec: clampInt(o.closeAfterToolSec, 0, 3600, d.closeAfterToolSec),
  };
}

function loadPrefs(): WallPrefs {
  try {
    return readWallPrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return DEFAULT_WALL_PREFS;
  }
}

/** Provider display name without the access-mode suffix. */
const providerLabel = (id: string) =>
  (PROVIDERS.find((p) => p.id === id)?.name ?? id).replace(/\s*\([^)]*\)$/, '');
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
  const [provider, setProvider] = useState('');
  const [providers, setProviders] = useState<string[]>([]);
  const providerOf = useRef(new Map<string, string[]>());
  const [prefs, setPrefs] = useState<WallPrefs>(loadPrefs);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const patchPrefs = (patch: Partial<WallPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked: the preferences last for this page only.
      }
      return next;
    });
  const newTab = useRef(prefs.defaultTab);
  newTab.current = prefs.defaultTab;
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
        const all = res.items ?? [];
        for (const s of all) providerOf.current.set(s.id, s.providers ?? []);
        setProviders((prev) => {
          const seen = new Set(prev);
          for (const s of all) for (const p of s.providers ?? []) seen.add(p);
          return seen.size === prev.length ? prev : [...seen].sort();
        });
        const items = provider ? all.filter((s) => s.providers?.includes(provider)) : all;
        const ids = new Set(items.map((s) => s.id));
        // A closed session that stopped may open again when it restarts.
        for (const id of dismissed.current) if (!ids.has(id)) dismissed.current.delete(id);
        const now = Date.now();
        setTiles((prev) =>
          reconcileWall(prev, items, {
            dismissed: dismissed.current,
            now,
            maxTiles: budget,
            touchedAt: touchedAt.current,
          }).map((tile) =>
            tile.addedAt === now && !tile.prefs.tab
              ? { ...tile, prefs: { ...tile.prefs, tab: newTab.current } }
              : tile,
          ),
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
  }, [agent, provider, budget]);

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
  const changeProvider = (value: string) => {
    setProvider(value);
    if (value)
      setTiles((prev) =>
        prev.filter((tile) => providerOf.current.get(tile.id)?.includes(value) ?? false),
      );
  };
  const providerOptions: SelectOption[] = [
    { label: t('sessions.wall.allProviders'), value: '' },
    ...providers.map((id) => ({ label: providerLabel(id), value: id })),
  ];

  const changeAgent = (value: string) => {
    setAgent(value);
    if (value) setTiles((prev) => prev.filter((tile) => tile.agentName === value));
  };

  const platformOf = useMemo(() => new Map(agents.map((a) => [a.agent_name, a])), [agents]);
  const iconOf = (name: string | null) => {
    const info = name ? platformOf.get(name) : undefined;
    return info?.agent_platform
      ? platformIcon(info.agent_platform, info.agent_category ?? null)
      : null;
  };
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

  useSignal(themePreference);

  // Floating windows in cascade: a slot per window (a closed one frees its
  // slot), moved by the header, resized by the edges, last touched in front.
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
  const winW = Math.max(240, Math.min(prefs.winW, area.w - 2 * CASCADE_GAP));
  const maxSize: Size = { w: area.w, h: area.h };
  const slots = useRef(new Map<string, number>());
  for (const id of [...slots.current.keys()])
    if (!tiles.some((tile) => tile.id === id)) slots.current.delete(id);
  for (const tile of tiles)
    if (!slots.current.has(tile.id)) slots.current.set(tile.id, freeSlot(slots.current.values()));
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
      height: prefs.winH,
      areaWidth: area.w,
      areaHeight: area.h,
    });
    const moved = tile.prefs.x != null && tile.prefs.y != null;
    const size = windowSize(tile.prefs, { w: winW, h: prefs.winH }, maxSize);
    return { tile, size, x: moved ? tile.prefs.x! : auto.x, y: moved ? tile.prefs.y! : auto.y };
  });
  const layerHeight = Math.max(0, ...placed.map((p) => p.y + p.size.h + CASCADE_GAP));
  const dark = effectiveTheme() === 'dark';
  const autoClose = useMemo(
    () => ({ answerMs: prefs.closeAfterAnswerSec * 1000, toolMs: prefs.closeAfterToolSec * 1000 }),
    [prefs.closeAfterAnswerSec, prefs.closeAfterToolSec],
  );
  const shownRunning = tiles.filter((tile) => tile.endedAt == null).length;
  const waiting = Math.max(0, runningTotal - shownRunning - dismissed.current.size);

  return (
    <main className="lab-hex live-wall flex min-h-screen flex-col text-ink">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line bg-elev px-3 py-1">
        <h1 className="m-0 flex items-center gap-2 text-sm font-semibold">
          <LiveDot />
          {t('sessions.wall.title')}
        </h1>
        <span className="text-xs text-muted" aria-live="polite">
          {t('sessions.wall.count', { count: Math.max(runningTotal, shownRunning) })}
        </span>
        {waiting > 0 ? (
          <span
            className="text-xs text-muted"
            title={t('sessions.wall.waitingHint', { max: budget })}
          >
            {t('sessions.wall.waiting', { count: waiting })}
          </span>
        ) : null}
        {failed ? <span className="text-xs text-warn">{t('sessions.wall.loadError')}</span> : null}
        <span className="flex-1" />
        <div className="w-full sm:w-48">
          <Select value={agent} onChange={changeAgent} options={agentOptions} />
        </div>
        <div className="w-full sm:w-48">
          <Select value={provider} onChange={changeProvider} options={providerOptions} />
        </div>
        <button
          type="button"
          className="lab-hex-win__btn"
          title={dark ? t('shell.topbar.themeLight') : t('shell.topbar.themeDark')}
          aria-label={dark ? t('shell.topbar.themeLight') : t('shell.topbar.themeDark')}
          onClick={toggleTheme}
        >
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button
          type="button"
          className="lab-hex-win__btn"
          title={t('sessions.wall.prefs.open')}
          aria-label={t('sessions.wall.prefs.open')}
          aria-expanded={prefsOpen}
          onClick={() => setPrefsOpen((v) => !v)}
        >
          <Settings2 size={14} />
        </button>
      </header>
      {prefsOpen ? (
        <WallPrefsPanel prefs={prefs} onChange={patchPrefs} onClose={() => setPrefsOpen(false)} />
      ) : null}

      {loaded && tiles.length === 0 ? (
        <div className="empty m-auto">
          <h3>{t('sessions.wall.emptyTitle')}</h3>
          <p className="max-w-md text-sm">{t('sessions.wall.emptyBody')}</p>
        </div>
      ) : (
        <div ref={layer} className="relative flex-1" style={{ minHeight: layerHeight }}>
          {placed.map(({ tile, size, x, y }) => {
            const feed = feeds.current.get(tile.id);
            if (!feed) return null;
            return (
              <WallWindow
                key={tile.id}
                tile={tile}
                feed={feed}
                x={x}
                y={y}
                size={size}
                maxSize={maxSize}
                z={stack.indexOf(tile.id) + 1}
                layer={layer}
                iconSrc={iconOf(tile.agentName) ?? null}
                onFront={() => toFront(tile.id)}
                onTouch={() => touch(tile.id)}
                onPrefs={(p) => onPrefs(tile.id, p)}
                onPin={() => patchTile(tile.id, (w) => ({ ...w, pinned: !w.pinned }))}
                onClose={() => closeTile(tile.id)}
                autoClose={autoClose}
              />
            );
          })}
        </div>
      )}
    </main>
  );
}

const CASCADE_GAP = 12;

/**
 * One floating window of the wall: absolute position (its cascade slot or
 * where the user dropped it), size (default or what the user resized it to),
 * drag by the header, resize by the right and bottom edges and the corner grip.
 */
function WallWindow({
  tile,
  feed,
  x,
  y,
  size,
  maxSize,
  z,
  layer,
  iconSrc,
  onFront,
  onTouch,
  onPrefs,
  onPin,
  onClose,
  autoClose,
}: {
  tile: WallTile;
  feed: LiveSessionFeed;
  x: number;
  y: number;
  size: Size;
  maxSize: Size;
  z: number;
  layer: RefObject<HTMLDivElement | null>;
  iconSrc: string | null;
  onFront: () => void;
  onTouch: () => void;
  onPrefs: (patch: LiveWindowPrefs) => void;
  onPin: () => void;
  onClose: () => void;
  /** Auto-close delays, ms (0: that case never closes). */
  autoClose: { answerMs: number; toolMs: number };
}) {
  useLiveFeed(feed);
  const ended = tile.endedAt != null;
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [resizing, setResizing] = useState<Size | null>(null);
  const [hover, setHover] = useState(false);
  const current = resizing ?? size;

  // Auto-close: the session's last item (an answer or a tool call) picks the
  // delay; new activity restarts it, hover/drag pause it, pinned windows stay.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closer = useRef<AutoCloser | null>(null);
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
  const off = kind === 'tool' ? autoClose.toolMs <= 0 : autoClose.answerMs <= 0;
  useEffect(() => {
    closer.current ??= new AutoCloser(() => onCloseRef.current());
    setCount(
      closer.current.update(
        { kind, activity, pinned: tile.pinned || off, ended, paused },
        autoClose,
      ),
    );
  }, [kind, activity, tile.pinned, off, ended, paused, autoClose]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!count || count.paused) return;
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [count]);
  const live = closer.current?.status() ?? null;
  const closesInSec = live ? Math.max(0, Math.ceil(live.remainingMs / 1000)) : null;

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0) return;
    if (target.closest('button, input, select, textarea, a, .lab-resize')) return;
    if (!target.closest('.lab-hex-win__head')) return;
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
      if (last.x !== x || last.y !== y) onPrefs({ x: last.x, y: last.y });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

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
      if (last.w !== start.w || last.h !== start.h) onPrefs(last);
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
    height: current.h,
    zIndex: z,
  };

  return (
    <div
      className={cx(
        'lab-wall-win',
        ended && !tile.pinned && 'opacity-70',
        (drag || resizing) && 'select-none',
      )}
      style={style}
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
      <HexLiveWindow
        feed={feed}
        prefs={tile.prefs}
        onPrefs={onPrefs}
        onClose={onClose}
        pinned={tile.pinned}
        onPin={onPin}
        ended={ended}
        iconSrc={iconSrc}
        closesInSec={closesInSec}
      />
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
        aria-hidden="true"
        onPointerDown={startResize('se')}
      />
    </div>
  );
}

/** The wall's preferences: window size, default tab and auto-close delays. */
function WallPrefsPanel({
  prefs,
  onChange,
  onClose,
}: {
  prefs: WallPrefs;
  onChange: (patch: Partial<WallPrefs>) => void;
  onClose: () => void;
}) {
  const num = (
    key: 'winW' | 'winH' | 'closeAfterAnswerSec' | 'closeAfterToolSec',
    min: number,
    max: number,
    unit: string,
  ) => (
    <label className="flex items-center justify-between gap-3 text-[12px] text-dim">
      <span>{t(`sessions.wall.prefs.${key}` as 'sessions.wall.prefs.winW')}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          value={prefs[key]}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange({ [key]: Math.min(max, Math.max(min, v)) });
          }}
          className="w-20 rounded border border-line bg-s2 px-2 py-0.5 text-right text-ink"
        />
        <span className="w-5 text-faint">{unit}</span>
      </span>
    </label>
  );
  return (
    <div
      role="dialog"
      aria-label={t('sessions.wall.prefs.title')}
      className="fixed right-3 top-10 z-[1000] w-80 space-y-3 rounded-xl border border-line bg-elev p-3 shadow-lg"
    >
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-sm font-semibold">{t('sessions.wall.prefs.title')}</h2>
        <button
          type="button"
          className="lab-hex-win__btn"
          title={t('liveSession.close')}
          aria-label={t('liveSession.close')}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      {num('winW', 240, 1200, 'px')}
      {num('winH', 200, 1200, 'px')}
      <div className="flex items-center justify-between gap-3 text-[12px] text-dim">
        <span>{t('sessions.wall.prefs.defaultTab')}</span>
        <span className="flex gap-1" role="group" aria-label={t('sessions.wall.prefs.defaultTab')}>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={prefs.defaultTab === tab}
              onClick={() => onChange({ defaultTab: tab })}
              className={cx(
                'rounded px-2 py-0.5',
                prefs.defaultTab === tab ? 'bg-s3 text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {t(`liveSession.tab.${tab}` as 'liveSession.tab.chat')}
            </button>
          ))}
        </span>
      </div>
      {num('closeAfterAnswerSec', 0, 3600, 's')}
      {num('closeAfterToolSec', 0, 3600, 's')}
      <p className="m-0 text-[11px] text-faint">{t('sessions.wall.prefs.autoCloseHint')}</p>
      <button
        type="button"
        className="text-[12px] text-muted underline hover:text-ink"
        onClick={() => onChange(DEFAULT_WALL_PREFS)}
      >
        {t('sessions.wall.prefs.reset')}
      </button>
    </div>
  );
}
