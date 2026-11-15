/**
 * Persistence of the live-session windows (`localStorage`, `thinker.liveWindows`):
 * which windows are open, front to back, and each session's position, size,
 * mode and tab. Every storage access is guarded: blocked storage only means
 * the windows do not come back after a reload.
 */

export type LiveTab = 'chat' | 'details' | 'inspector';
export type LiveMode = 'normal' | 'compact' | 'minimized';

export interface LiveWindowPrefs {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  mode?: LiveMode;
  tab?: LiveTab;
  maximized?: boolean;
}

export interface LiveWindowEntry {
  sessionId: string;
  /** false: a finished session, opened as a replay. */
  live: boolean;
  /** Cascade slot, so reopened windows keep their offset. */
  slot: number;
}

export interface LiveWindowsSnapshot {
  /** Open windows in opening order (stable DOM order). */
  open: LiveWindowEntry[];
  /** Session ids bottom to top (the last one is in front). */
  stack: string[];
  prefs: Record<string, LiveWindowPrefs>;
}

export const LIVE_WINDOWS_KEY = 'thinker.liveWindows';
export const MAX_LIVE_WINDOWS = 4;
/** Sessions whose prefs are kept (most recent first); older ones are forgotten. */
const MAX_PREFS = 30;
const CASCADE_SLOTS = 6;

export const emptyLiveWindows = (): LiveWindowsSnapshot => ({ open: [], stack: [], prefs: {} });

const TABS = new Set<LiveTab>(['chat', 'details', 'inspector']);
const MODES = new Set<LiveMode>(['normal', 'compact', 'minimized']);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function cleanPrefs(raw: unknown): LiveWindowPrefs {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: LiveWindowPrefs = {};
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    const v = num(p[k]);
    if (v !== undefined) out[k] = v;
  }
  if (MODES.has(p.mode as LiveMode)) out.mode = p.mode as LiveMode;
  if (TABS.has(p.tab as LiveTab)) out.tab = p.tab as LiveTab;
  if (typeof p.maximized === 'boolean') out.maximized = p.maximized;
  return out;
}

/** Reads the saved windows; anything malformed is dropped. */
export function readLiveWindows(storage: Storage | null = safeStorage()): LiveWindowsSnapshot {
  try {
    const raw = storage?.getItem(LIVE_WINDOWS_KEY);
    if (!raw) return emptyLiveWindows();
    const parsed = JSON.parse(raw) as Partial<LiveWindowsSnapshot>;
    const seen = new Set<string>();
    const open: LiveWindowEntry[] = [];
    for (const e of Array.isArray(parsed.open) ? parsed.open : []) {
      if (!e || typeof e.sessionId !== 'string' || !e.sessionId || seen.has(e.sessionId)) continue;
      seen.add(e.sessionId);
      open.push({ sessionId: e.sessionId, live: e.live !== false, slot: num(e.slot) ?? 0 });
    }
    const trimmed = open.slice(-MAX_LIVE_WINDOWS);
    const ids = new Set(trimmed.map((e) => e.sessionId));
    const stack = (Array.isArray(parsed.stack) ? parsed.stack : []).filter(
      (id): id is string => typeof id === 'string' && ids.has(id),
    );
    for (const e of trimmed) if (!stack.includes(e.sessionId)) stack.push(e.sessionId);
    const prefs: Record<string, LiveWindowPrefs> = {};
    if (parsed.prefs && typeof parsed.prefs === 'object')
      for (const [id, p] of Object.entries(parsed.prefs)) prefs[id] = cleanPrefs(p);
    return { open: trimmed, stack: [...new Set(stack)], prefs };
  } catch {
    return emptyLiveWindows();
  }
}

export function writeLiveWindows(
  snap: LiveWindowsSnapshot,
  storage: Storage | null = safeStorage(),
): void {
  try {
    // Keep the open windows' prefs and the most recently touched others.
    const keep = new Set(snap.open.map((e) => e.sessionId));
    const prefs: Record<string, LiveWindowPrefs> = {};
    const ids = Object.keys(snap.prefs);
    for (const id of ids) if (keep.has(id)) prefs[id] = snap.prefs[id]!;
    for (const id of ids.reverse()) {
      if (Object.keys(prefs).length >= MAX_PREFS) break;
      if (!(id in prefs)) prefs[id] = snap.prefs[id]!;
    }
    storage?.setItem(LIVE_WINDOWS_KEY, JSON.stringify({ ...snap, prefs }));
  } catch {
    // Storage blocked or full: the windows last for this page only.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Opens (or brings to front) a session's window. A fifth window closes the
 * oldest one. Returns the new snapshot and the session ids that were closed.
 */
export function openLiveWindow(
  snap: LiveWindowsSnapshot,
  sessionId: string,
  live: boolean,
): { next: LiveWindowsSnapshot; closed: string[] } {
  const existing = snap.open.find((e) => e.sessionId === sessionId);
  if (existing) {
    const open =
      existing.live === live
        ? snap.open
        : snap.open.map((e) => (e.sessionId === sessionId ? { ...e, live } : e));
    return { next: { ...snap, open, stack: toFront(snap.stack, sessionId) }, closed: [] };
  }
  let open = snap.open;
  const closed: string[] = [];
  while (open.length >= MAX_LIVE_WINDOWS) {
    closed.push(open[0]!.sessionId);
    open = open.slice(1);
  }
  const used = new Set(open.map((e) => e.slot));
  let slot = 0;
  while (used.has(slot) && slot < CASCADE_SLOTS) slot++;
  open = [...open, { sessionId, live, slot: slot % CASCADE_SLOTS }];
  const stack = [...snap.stack.filter((id) => !closed.includes(id) && id !== sessionId), sessionId];
  // Touching the prefs moves the session to the end (most recent).
  const { [sessionId]: own, ...rest } = snap.prefs;
  return { next: { open, stack, prefs: { ...rest, [sessionId]: own ?? {} } }, closed };
}

export function closeLiveWindow(snap: LiveWindowsSnapshot, sessionId: string): LiveWindowsSnapshot {
  return {
    ...snap,
    open: snap.open.filter((e) => e.sessionId !== sessionId),
    stack: snap.stack.filter((id) => id !== sessionId),
  };
}

export function focusLiveWindow(snap: LiveWindowsSnapshot, sessionId: string): LiveWindowsSnapshot {
  if (snap.stack.at(-1) === sessionId) return snap;
  return { ...snap, stack: toFront(snap.stack, sessionId) };
}

export function patchLiveWindowPrefs(
  snap: LiveWindowsSnapshot,
  sessionId: string,
  patch: LiveWindowPrefs,
): LiveWindowsSnapshot {
  return { ...snap, prefs: { ...snap.prefs, [sessionId]: { ...snap.prefs[sessionId], ...patch } } };
}

const toFront = (stack: string[], id: string) => [...stack.filter((x) => x !== id), id];
