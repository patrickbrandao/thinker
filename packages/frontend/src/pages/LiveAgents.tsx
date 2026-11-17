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
import {
  Bot,
  BotMessageSquare,
  Brain,
  CircleDashed,
  EyeOff,
  FaceSlightlySmiling,
  Moon,
  RobotArm,
  Settings2,
  Sun,
  Wrench,
  X,
} from 'lucide-react';
import { platformIcon, type LiveGlance, type LiveGlanceKind } from 'thinker-shared';
import Select, { type SelectOption } from '../components/Select.js';
import { ThemedIcon } from '../components/setup-ui.js';
import { Switch, cx } from '../components/ui.js';
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
import {
  getLiveGlance,
  getSessions,
  type LiveGlanceItem,
  type SessionSummary,
} from '../services/api/sessions.js';
import { shortId } from './sessions/session-format.js';
import { LiveSessionFeed, useLiveFeed } from '../services/live-session-feed.js';

export const WALL_POLL_MS = 5_000;
/** How often the session chips refresh what each session ends with. */
export const WALL_GLANCE_MS = 2_000;
/** The dot grid's cell, px (hex-live.css `.live-wall`). */
const GRID = 24;
/**
 * A session leaves the running set five minutes after its last activity (the
 * backend's rule). A chip the user dragged stays that long again, so it takes
 * twice as long to disappear.
 */
export const WALL_CHIP_LINGER_MS = 5 * 60_000;

interface ChipPos {
  x: number;
  y: number;
}

/**
 * The line from a main session's chip to a subagent's, in right angles and
 * always over the free cells between chips (a chip is one cell wide and two
 * tall; the flow leaves a free column and a free row between chips):
 *
 * - side by side: a horizontal line between the facing edges;
 * - one right above the other: a vertical line;
 * - far apart on the same row: out of the top, along the free row above, and
 *   down into the other's top;
 * - on different rows: out of the bottom of the upper one, along the free row
 *   below it, down the free column beside the lower one and into its top.
 *
 * Returns the corner points, from `from` to `to`.
 */
export function chipLinkPoints(from: ChipPos, to: ChipPos): [number, number][] {
  const W = GRID;
  const H = 2 * GRID;
  const half = GRID / 2;
  if (from.y === to.y) {
    const dx = to.x - from.x;
    if (Math.abs(dx) <= 2 * GRID) {
      const mid = from.y + H / 2;
      return dx >= 0
        ? [
            [from.x + W, mid],
            [to.x, mid],
          ]
        : [
            [from.x, mid],
            [to.x + W, mid],
          ];
    }
    const lane = from.y - half;
    return [
      [from.x + half, from.y],
      [from.x + half, lane],
      [to.x + half, lane],
      [to.x + half, to.y],
    ];
  }
  const down = from.y < to.y;
  const a = down ? from : to;
  const b = down ? to : from;
  let pts: [number, number][];
  if (a.x === b.x && b.y - a.y <= 3 * GRID) {
    pts = [
      [a.x + half, a.y + H],
      [a.x + half, b.y],
    ];
  } else {
    const laneA = a.y + H + half;
    const laneB = b.y - half;
    pts = [
      [a.x + half, a.y + H],
      [a.x + half, laneA],
    ];
    if (laneB > laneA) {
      // Rows in between: go down the free column beside the lower chip.
      const col = b.x + (a.x < b.x ? -half : W + half);
      pts.push([col, laneA], [col, laneB]);
    }
    pts.push([b.x + half, Math.max(laneA, laneB)], [b.x + half, b.y]);
  }
  return down ? pts : pts.reverse();
}

/** What a chip (and a window) needs from its session: a main session or a subagent's. */
type ChipSession = Pick<SessionSummary, 'id' | 'agent_name' | 'in_flight' | 'last_at'>;

/** A chip being dragged: where it started and where it is now. */
interface ChipDrag {
  id: string;
  from: ChipPos;
  to: ChipPos;
}

/** Nearest grid position (chip edges run over the dots, which sit half a cell in). */
const snapToGrid = (v: number) => GRID / 2 + Math.max(0, Math.round((v - GRID / 2) / GRID)) * GRID;

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
  /** Open a window by itself for every running session (off: only the ones the user asks for). */
  autoShow: boolean;
}

export const DEFAULT_WALL_PREFS: WallPrefs = {
  winW: 440,
  winH: 480,
  defaultTab: 'chat',
  closeAfterAnswerSec: 10,
  closeAfterToolSec: 60,
  autoShow: false,
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
    autoShow: o.autoShow === true,
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
  /** Sessions the user opened by hand: they keep their slot like pinned ones. */
  keep?: ReadonlySet<string>;
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
  const keep = opts.keep;
  const pinned = next
    .filter((t) => runningTile(t) && (t.pinned || keep?.has(t.id)))
    .map((t) => t.id);
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
  /** The running sessions that pass the filters (one chip each). */
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const itemsRef = useRef<SessionSummary[]>([]);
  /** Where the user dropped each chip they dragged. */
  const [chipPos, setChipPos] = useState<Map<string, ChipPos>>(() => new Map());
  const chipPosRef = useRef(chipPos);
  chipPosRef.current = chipPos;
  /** Dragged chips whose session left the running set: they stay until `until`. */
  const [lingering, setLingering] = useState<
    Map<string, { session: SessionSummary; until: number }>
  >(() => new Map());
  const lingeringRef = useRef(lingering);
  lingeringRef.current = lingering;
  const [glance, setGlance] = useState<Map<string, LiveGlanceItem>>(() => new Map());
  /** Running subagent sessions of the sessions on the wall, by main session. */
  const kidsOf = useMemo(() => {
    const roots = new Map(sessions.map((s) => [s.id, s]));
    const map = new Map<string, ChipSession[]>();
    for (const g of glance.values()) {
      const parent = g.parentId ? roots.get(g.parentId) : undefined;
      if (!parent || roots.has(g.id) || (g.idleMs ?? 0) > WALL_CHIP_LINGER_MS) continue;
      const list = map.get(parent.id) ?? [];
      list.push({
        id: g.id,
        agent_name: g.agentName ?? parent.agent_name,
        in_flight: g.streaming ? 1 : 0,
        last_at: new Date(Date.now() - (g.idleMs ?? 0)).toISOString(),
      });
      map.set(parent.id, list);
    }
    for (const list of map.values()) list.sort((x, y) => x.id.localeCompare(y.id));
    return map;
  }, [sessions, glance]);
  const kidsRef = useRef(kidsOf);
  kidsRef.current = kidsOf;
  const allKids = () => [...kidsRef.current.values()].flat();
  /** The chip under drag (its subagents follow it), and the family under the mouse. */
  const [chipDrag, setChipDrag] = useState<ChipDrag | null>(null);
  const [focusRoot, setFocusRoot] = useState<string | null>(null);
  const dismissed = useRef(new Set<string>());
  /** A chip landed: it stays there, and its subagents the user placed move along. */
  const dropChip = useCallback((d: ChipDrag) => {
    setChipPos((prev) => {
      const next = new Map(prev).set(d.id, d.to);
      for (const kid of kidsRef.current.get(d.id) ?? []) {
        const at = prev.get(kid.id);
        if (at) next.set(kid.id, { x: at.x + d.to.x - d.from.x, y: at.y + d.to.y - d.from.y });
      }
      return next;
    });
    setChipDrag(null);
  }, []);
  /** Sessions the user opened by hand (chip or the "not shown" pill). */
  const manual = useRef(new Set<string>());
  /** Cascade wave of tiles opened by the "not shown" pill (0: the base cascade). */
  const pendingWave = useRef(new Map<string, number>());
  const waveCounter = useRef(0);
  /** When each session last got a window, so the pill cycles through all of them. */
  const shownAt = useRef(new Map<string, number>());
  const autoShowRef = useRef(prefs.autoShow);
  autoShowRef.current = prefs.autoShow;
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

  // The next wall from the running sessions. With "show automatically" off,
  // only the windows already open and the ones the user asked for take part.
  const applyItems = useCallback(
    (items: SessionSummary[]) => {
      const now = Date.now();
      setTiles((prev) => {
        const have = new Set(prev.map((tile) => tile.id));
        // Subagent sessions never open by themselves: only the ones the user asked for.
        const asked = (x: ChipSession) => manual.current.has(x.id) || have.has(x.id);
        const candidates: ChipSession[] = [
          ...(autoShowRef.current ? items : items.filter(asked)),
          ...allKids().filter(asked),
        ];
        const next = reconcileWall(prev, candidates, {
          dismissed: dismissed.current,
          now,
          maxTiles: budget,
          touchedAt: touchedAt.current,
          keep: manual.current,
        });
        if (next === prev) return prev;
        return next.map((tile) => {
          if (tile.addedAt !== now || tile.prefs.tab) return tile;
          shownAt.current.set(tile.id, now);
          return { ...tile, prefs: { ...tile.prefs, tab: newTab.current } };
        });
      });
    },
    [budget],
  );

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
        const known = new Set([...ids, ...allKids().map((k) => k.id)]);
        for (const id of dismissed.current) if (!known.has(id)) dismissed.current.delete(id);
        for (const id of manual.current) if (!known.has(id)) manual.current.delete(id);
        // A dragged chip outlives its session's stay in the running set.
        const gone = itemsRef.current.filter((s) => !ids.has(s.id) && chipPosRef.current.has(s.id));
        const nowMs = Date.now();
        setLingering((prev) => {
          const next = new Map(prev);
          for (const s of gone) next.set(s.id, { session: s, until: nowMs + WALL_CHIP_LINGER_MS });
          for (const [id, l] of next) if (ids.has(id) || l.until <= nowMs) next.delete(id);
          return next.size === prev.size && gone.length === 0 ? prev : next;
        });
        setChipPos((prev) => {
          const keep = new Set([...known, ...gone.map((s) => s.id)]);
          const stale = [...prev.keys()].filter(
            (id) => !keep.has(id) && !((lingeringRef.current.get(id)?.until ?? 0) > nowMs),
          );
          if (!stale.length) return prev;
          const next = new Map(prev);
          for (const id of stale) next.delete(id);
          return next;
        });
        itemsRef.current = items;
        setSessions(items);
        applyItems(items);
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
  }, [agent, provider, budget, applyItems]);

  // Turning "show automatically" on opens the windows right away.
  useEffect(() => {
    if (prefs.autoShow) applyItems(itemsRef.current);
  }, [prefs.autoShow, applyItems]);

  // What each session ends with, for the chips.
  useEffect(() => {
    let alive = true;
    const load = () =>
      getLiveGlance()
        .then((res) => {
          if (alive) setGlance(new Map((res.items ?? []).map((g) => [g.id, g])));
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), WALL_GLANCE_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

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
    manual.current.delete(id);
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
    itemsRef.current = [];
    setLingering(new Map());
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
    itemsRef.current = [];
    setLingering(new Map());
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
  const slots = useRef(new Map<string, { wave: number; slot: number }>());
  for (const id of [...slots.current.keys()])
    if (!tiles.some((tile) => tile.id === id)) slots.current.delete(id);
  for (const tile of tiles) {
    if (slots.current.has(tile.id)) continue;
    const wave = pendingWave.current.get(tile.id) ?? 0;
    pendingWave.current.delete(tile.id);
    const taken = [...slots.current.values()].filter((v) => v.wave === wave).map((v) => v.slot);
    slots.current.set(tile.id, { wave, slot: freeSlot(taken) });
  }
  const [stack, setStack] = useState<string[]>([]);
  const stackRef = useRef(stack);
  stackRef.current = stack;
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
  // Session chips: one grid cell wide, two tall, a free column and row between them.
  const chipSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          (a.agent_name ?? '').localeCompare(b.agent_name ?? '') ||
          (a.started_at ?? '').localeCompare(b.started_at ?? '') ||
          a.id.localeCompare(b.id),
      ),
    [sessions],
  );
  const chipCols = Math.max(1, Math.floor((area.w - GRID) / (2 * GRID)));
  // Chips flow left to right, a main session followed by its subagents. The
  // ones the user dragged stay where they were dropped (a subagent not placed
  // by hand sits to the right of its dragged parent), and the flow skips the
  // places they cover.
  const parentOf = new Map<string, string>();
  for (const [root, kids] of kidsOf) for (const k of kids) parentOf.set(k.id, root);
  const fixedOf = (id: string): ChipPos | undefined => {
    if (chipDrag?.id === id) return chipDrag.to;
    const at = chipPos.get(id);
    if (at && chipDrag && parentOf.get(id) === chipDrag.id)
      return {
        x: at.x + chipDrag.to.x - chipDrag.from.x,
        y: at.y + chipDrag.to.y - chipDrag.from.y,
      };
    return at;
  };
  const blocked: ChipPos[] = [];
  const under = new Map<string, ChipPos>();
  for (const s of chipSessions) {
    const rf = fixedOf(s.id);
    if (rf) blocked.push(rf);
    (kidsOf.get(s.id) ?? []).forEach((k, n) => {
      const kf = fixedOf(k.id);
      if (kf) return blocked.push(kf);
      if (!rf) return;
      // Under a dragged parent: the first right below it, the next ones to the right.
      const at = { x: rf.x + n * 2 * GRID, y: rf.y + 3 * GRID };
      under.set(k.id, at);
      blocked.push(at);
    });
  }
  for (const id of lingering.keys()) {
    const at = chipPos.get(id);
    if (at) blocked.push(at);
  }
  const covered = (at: ChipPos) =>
    blocked.some((d) => Math.abs(d.x - at.x) < GRID && Math.abs(d.y - at.y) < 2 * GRID);
  const slotAt = (col: number, row: number): ChipPos => ({
    x: GRID / 2 + col * 2 * GRID,
    y: GRID / 2 + row * 3 * GRID,
  });
  // The flow: main sessions left to right; a session's subagents go on the row
  // below it, the first right under it (that row is then theirs alone).
  let col = 0;
  let row = 0;
  /** Rows under the current one taken by subagents. */
  let kidRows = 0;
  let flowRows = 0;
  const newRow = () => {
    row += 1 + kidRows;
    col = 0;
    kidRows = 0;
  };
  const chipPlaces: {
    session: ChipSession;
    x: number;
    y: number;
    gone: boolean;
    /** Main session of a subagent chip. */
    parent: string | null;
  }[] = [];
  for (const s of chipSessions) {
    const kids = kidsOf.get(s.id) ?? [];
    const rf = fixedOf(s.id);
    if (rf) {
      chipPlaces.push({ session: s, ...rf, gone: false, parent: null });
      for (const k of kids)
        chipPlaces.push({
          session: k,
          ...(fixedOf(k.id) ?? under.get(k.id)!),
          gone: false,
          parent: s.id,
        });
      continue;
    }
    const flowKids = kids.filter((k) => !fixedOf(k.id));
    // The family's width: its subagents side by side on the row below.
    const width = Math.min(chipCols, Math.max(1, flowKids.length));
    let at: ChipPos;
    for (;;) {
      if (col > 0 && col + width > chipCols) newRow();
      at = slotAt(col, row);
      if (!covered(at)) break;
      col += 1;
    }
    const first = col;
    col += width;
    chipPlaces.push({ session: s, ...at, gone: false, parent: null });
    flowRows = Math.max(flowRows, row + 1);
    let n = 0;
    for (const k of kids) {
      const kf = fixedOf(k.id);
      if (kf) {
        chipPlaces.push({ session: k, ...kf, gone: false, parent: s.id });
        continue;
      }
      const down = 1 + Math.floor(n / width);
      let spot = slotAt(first + (n % width), row + down);
      n += 1;
      if (covered(spot)) {
        // No room below: beside the family, on its own row.
        spot = slotAt(col, row);
        col += 1;
      } else {
        kidRows = Math.max(kidRows, down);
        flowRows = Math.max(flowRows, row + down + 1);
      }
      chipPlaces.push({ session: k, ...spot, gone: false, parent: s.id });
    }
  }
  for (const [id, l] of lingering) {
    const at = chipPos.get(id);
    if (at && !chipSessions.some((s) => s.id === id))
      chipPlaces.push({ session: l.session, ...at, gone: true, parent: null });
  }
  const placeOf = new Map(chipPlaces.map((c) => [c.session.id, c]));
  const chipLinks = chipPlaces.flatMap((c) => {
    const from = c.parent ? placeOf.get(c.parent) : undefined;
    return from ? [{ from, to: c }] : [];
  });
  const chipsHeight = flowRows ? GRID / 2 + flowRows * 3 * GRID : 0;
  // The cascade starts below a free band one window tall; more chips than that push it down.
  const chipsPush = Math.max(0, chipsHeight - (CASCADE_GAP + prefs.winH));
  const placed = tiles.map((tile) => {
    const at = slots.current.get(tile.id) ?? { wave: 0, slot: 0 };
    const auto = cascadePosition(at.slot, {
      width: winW,
      height: prefs.winH,
      areaWidth: area.w,
      areaHeight: area.h,
    });
    const moved = tile.prefs.x != null && tile.prefs.y != null;
    const size = windowSize(tile.prefs, { w: winW, h: prefs.winH }, maxSize);
    return {
      tile,
      size,
      x: moved ? tile.prefs.x! : auto.x + at.wave * GRID,
      y: moved ? tile.prefs.y! : auto.y + at.wave * GRID + chipsPush,
    };
  });
  const layerHeight = Math.max(0, ...placed.map((p) => p.y + p.size.h + CASCADE_GAP));
  const dark = effectiveTheme() === 'dark';
  const autoClose = useMemo(
    () => ({ answerMs: prefs.closeAfterAnswerSec * 1000, toolMs: prefs.closeAfterToolSec * 1000 }),
    [prefs.closeAfterAnswerSec, prefs.closeAfterToolSec],
  );
  const tileIds = new Set(tiles.map((tile) => tile.id));
  const hiddenCount = sessions.filter((s) => !tileIds.has(s.id)).length;

  const newTile = (s: ChipSession, now: number): WallTile => {
    shownAt.current.set(s.id, now);
    return {
      id: s.id,
      agentName: s.agent_name,
      endedAt: null,
      pinned: false,
      prefs: { tab: newTab.current },
      addedAt: now,
      busyAt: s.in_flight > 0 ? now : null,
    };
  };

  /** A chip click: brings the session's window to the front, opening it when hidden. */
  const openSession = (id: string) => {
    const s: ChipSession | undefined =
      itemsRef.current.find((x) => x.id === id) ?? allKids().find((x) => x.id === id);
    if (!s) return;
    dismissed.current.delete(id);
    manual.current.add(id);
    if (tileIds.has(id)) return toFront(id);
    const now = Date.now();
    setTiles((prev) => {
      if (prev.some((tile) => tile.id === id)) return prev;
      let next = prev;
      const live = prev.filter((tile) => tile.endedAt == null);
      if (live.length >= budget) {
        // No free connection: the window furthest back gives its place.
        const order = stackRef.current;
        const victim = live
          .filter((tile) => !tile.pinned)
          .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0];
        if (!victim) return prev;
        manual.current.delete(victim.id);
        next = prev.filter((tile) => tile.id !== victim.id);
      }
      // Beside its chip: one cell of gap to the right, the window's middle at the chip's.
      const chip = placeOf.get(id);
      const tile = newTile(s, now);
      if (!chip) return [...next, tile];
      const right = chip.x + 2 * GRID;
      const x =
        right + winW <= area.w || chip.x - GRID - winW < 0
          ? Math.max(0, Math.min(right, area.w - winW))
          : chip.x - GRID - winW;
      const y = Math.max(0, Math.round(chip.y + GRID - prefs.winH / 2));
      return [...next, { ...tile, prefs: { ...tile.prefs, x, y } }];
    });
  };

  /**
   * The "not shown" pill: opens the hidden sessions, as many as there are free
   * connections. With none free, the unpinned windows give way to the next
   * hidden ones, so repeated clicks walk through every session. Each click
   * cascades one grid cell further right and down than the previous windows.
   */
  const showHidden = () => {
    const hidden = itemsRef.current
      .filter((s) => !tileIds.has(s.id))
      .sort(
        (a, b) =>
          (shownAt.current.get(a.id) ?? 0) - (shownAt.current.get(b.id) ?? 0) || byPriority(a, b),
      );
    if (!hidden.length) return;
    const wave = tiles.length === 0 ? 0 : (waveCounter.current = (waveCounter.current % 5) + 1);
    const now = Date.now();
    setTiles((prev) => {
      const live = prev.filter((tile) => tile.endedAt == null);
      let free = budget - live.length;
      let next = prev;
      if (free <= 0) {
        // Only as many as there are hidden sessions, the longest-shown first.
        const out = new Set(
          live
            .filter((tile) => !tile.pinned)
            .sort((x, y) => (shownAt.current.get(x.id) ?? 0) - (shownAt.current.get(y.id) ?? 0))
            .slice(0, hidden.length)
            .map((tile) => tile.id),
        );
        if (!out.size) return prev;
        for (const id of out) manual.current.delete(id);
        next = prev.filter((tile) => !out.has(tile.id));
        free = out.size;
      }
      const add = hidden.filter((s) => !next.some((tile) => tile.id === s.id)).slice(0, free);
      for (const s of add) {
        dismissed.current.delete(s.id);
        manual.current.add(s.id);
        pendingWave.current.set(s.id, wave);
      }
      return [...next, ...add.map((s) => newTile(s, now))];
    });
  };

  return (
    <main className="lab-hex flex min-h-screen flex-col text-ink">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line bg-elev px-3 py-1">
        <h1 className="m-0 flex items-center gap-2 text-sm font-semibold">
          <LiveDot />
          {t('sessions.wall.title')}
        </h1>
        <span className="wall-pill" aria-live="polite">
          <i className="wall-pill__dot" aria-hidden="true" />
          {t('sessions.wall.shown', { count: tiles.length })}
        </span>
        <button
          type="button"
          className="wall-pill wall-pill--action"
          disabled={hiddenCount === 0}
          title={t('sessions.wall.hiddenHint', { max: budget })}
          onClick={showHidden}
        >
          <EyeOff size={12} aria-hidden="true" />
          {t('sessions.wall.hidden', { count: hiddenCount })}
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-dim">
          <Switch
            checked={prefs.autoShow}
            onChange={(autoShow) => patchPrefs({ autoShow })}
            label={t('sessions.wall.autoShow')}
          />
          <span title={t('sessions.wall.autoShowHint')}>{t('sessions.wall.autoShow')}</span>
        </label>
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

      {loaded && tiles.length === 0 && sessions.length === 0 && lingering.size === 0 ? (
        <div className="live-wall flex flex-1">
          <div className="empty m-auto">
            <h3>{t('sessions.wall.emptyTitle')}</h3>
            <p className="max-w-md text-sm">{t('sessions.wall.emptyBody')}</p>
          </div>
        </div>
      ) : (
        <div
          ref={layer}
          className="live-wall relative flex-1"
          style={{ minHeight: Math.max(layerHeight, chipsHeight) }}
        >
          <svg className="wall-links" aria-hidden="true">
            {chipLinks.map(({ from, to }) => {
              const g = glance.get(to.session.id) ?? IDLE_GLANCE;
              const d = chipLinkPoints(from, to)
                .map(([x, y], n) => `${n ? 'L' : 'M'} ${x} ${y}`)
                .join(' ');
              return (
                <path
                  key={to.session.id}
                  className={cx(
                    'wall-link',
                    g.streaming && 'wall-link--live',
                    focusRoot != null && focusRoot !== from.session.id && 'wall-link--dim',
                    focusRoot === from.session.id && 'wall-link--focus',
                  )}
                  data-kind={g.last}
                  data-link={`${from.session.id}>${to.session.id}`}
                  d={d}
                />
              );
            })}
          </svg>
          {chipPlaces.map(({ session: s, x, y, gone, parent }) => {
            const root = parent ?? s.id;
            return (
              <SessionChip
                key={s.id}
                session={s}
                glance={glance.get(s.id) ?? IDLE_GLANCE}
                iconSrc={iconOf(s.agent_name) ?? null}
                shown={tileIds.has(s.id)}
                gone={gone}
                sub={parent != null}
                dim={focusRoot != null && focusRoot !== root}
                dragging={chipDrag?.id === s.id}
                left={x}
                top={y}
                layer={layer}
                onOpen={() => openSession(s.id)}
                onDrag={(to, from) => setChipDrag({ id: s.id, from, to })}
                onDrop={(to, from) => dropChip({ id: s.id, from, to })}
                // A family lights up only when there is one (a session with subagents).
                onHover={(over) =>
                  setFocusRoot(over && (kidsOf.get(root)?.length ?? 0) > 0 ? root : null)
                }
              />
            );
          })}
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

const IDLE_GLANCE: LiveGlance = { last: 'idle', streaming: false };

const GLANCE_ICON: Record<LiveGlanceKind, typeof Bot> = {
  assistant: BotMessageSquare,
  thinking: Brain,
  tool_call: Wrench,
  tool_result: RobotArm,
  user: FaceSlightlySmiling,
  idle: CircleDashed,
};

/**
 * One running session on the dot grid: a card one cell wide and two tall. The
 * top cell is the harness icon; the bottom one is what the conversation ends
 * with (answer, thinking, tool call, tool result, user prompt), blinking while
 * the provider streams it. A click opens the session's window.
 */
function SessionChip({
  session,
  glance,
  iconSrc,
  shown,
  gone,
  sub,
  dim,
  dragging,
  left,
  top,
  layer,
  onOpen,
  onDrag,
  onDrop,
  onHover,
}: {
  session: ChipSession;
  glance: LiveGlance;
  iconSrc: string | null;
  shown: boolean;
  /** The session left the running set; the chip stays because the user dragged it. */
  gone: boolean;
  /** A subagent session (linked to its main session's chip). */
  sub: boolean;
  /** Another family is under the mouse. */
  dim: boolean;
  dragging: boolean;
  left: number;
  top: number;
  layer: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
  /** The chip is being dragged: where it is now (on the grid) and where it started. */
  onDrag: (to: ChipPos, from: ChipPos) => void;
  /** The user dropped the chip. */
  onDrop: (to: ChipPos, from: ChipPos) => void;
  onHover: (over: boolean) => void;
}) {
  /** A drag just ended: the click that follows it does not open the window. */
  const dragged = useRef(false);
  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const from = { x: left, y: top };
    let last: ChipPos | null = null;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!last && Math.hypot(dx, dy) < 4) return;
      const maxX = Math.max(GRID / 2, (layer.current?.clientWidth || Infinity) - GRID * 1.5);
      last = {
        x: Math.min(snapToGrid(from.x + dx), snapToGrid(maxX)),
        y: snapToGrid(from.y + dy),
      };
      onDrag(last, from);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!last) return;
      dragged.current = true;
      setTimeout(() => (dragged.current = false), 0);
      onDrop(last, from);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const Icon = GLANCE_ICON[glance.last];
  const label = [
    (sub ? `${t('sessions.wall.subagent')} · ` : '') + (session.agent_name ?? shortId(session.id)),
    shortId(session.id),
    t(`sessions.wall.glance.${glance.last}` as 'sessions.wall.glance.idle') +
      (glance.streaming ? ` (${t('sessions.wall.glance.streaming')})` : ''),
  ].join(' · ');
  return (
    <button
      type="button"
      className={cx(
        'wall-chip',
        shown && 'wall-chip--shown',
        session.in_flight > 0 && !gone && 'wall-chip--busy',
        gone && 'wall-chip--gone',
        sub && 'wall-chip--sub',
        dim && 'wall-chip--dim',
        dragging && 'wall-chip--dragging',
      )}
      style={{ left, top }}
      onPointerDown={startDrag}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      data-kind={glance.last}
      data-session={session.id}
      aria-pressed={shown}
      title={label}
      aria-label={label}
      onClick={() => {
        if (!dragged.current) onOpen();
      }}
    >
      <span className="wall-chip__cell">
        {iconSrc ? (
          <ThemedIcon src={iconSrc} size={15} className="platform-icon rounded-[3px]" />
        ) : (
          <Bot size={14} />
        )}
      </span>
      <span
        className={cx('wall-chip__cell wall-chip__state', glance.streaming && 'wall-chip--blink')}
      >
        <Icon size={14} />
      </span>
    </button>
  );
}

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
