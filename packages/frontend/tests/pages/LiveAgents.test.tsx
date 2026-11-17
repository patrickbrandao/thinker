import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockGetSessions = vi.fn();
const mockGetLiveGlance = vi.fn();
vi.mock('../../src/services/api/sessions', async (orig) => ({
  ...(await orig<typeof import('../../src/services/api/sessions')>()),
  getSessions: (...a: unknown[]) => mockGetSessions(...a),
  getLiveGlance: (...a: unknown[]) => mockGetLiveGlance(...a),
}));
vi.mock('../../src/services/api', () => ({
  getAgents: vi.fn(async () => ({ agents: [] })),
}));

import LiveAgents, {
  chipLinkPoints,
  DEFAULT_WALL_PREFS,
  readWallPrefs,
  reconcileWall,
  WALL_CHIP_LINGER_MS,
  WALL_GRACE_MS,
  WALL_POLL_MS,
  WALL_SETTLE_MS,
  WALL_TOUCH_MS,
} from '../../src/pages/LiveAgents';
import { LIVE_WINDOWS_KEY } from '../../src/components/live-session/live-windows-store';
import { LiveSessionFeed } from '../../src/services/live-session-feed';

const feeds = new Map<string, LiveSessionFeed>();
function makeFeed(sessionId: string) {
  const feed = new LiveSessionFeed(sessionId, {
    live: true,
    EventSource: undefined,
    loadPage: vi.fn(async () => ({
      session: { sessionId, agentName: null, harness: null },
      events: [],
      next_after: null,
    })),
  });
  vi.spyOn(feed, 'dispose');
  feeds.set(sessionId, feed);
  return feed;
}

/** Running sessions, most recent activity first; `busy` ones have a request in flight. */
const running = (...ids: string[]) => ({
  items: ids.map((id, i) => ({
    id: id.replace('*', ''),
    agent_name: 'agent-' + id.replace('*', ''),
    in_flight: id.endsWith('*') ? 1 : 0,
    last_at: new Date(Date.now() - i * 1000).toISOString(),
  })),
  has_more: false,
});

const tile = (id: string) => screen.queryByRole('region', { name: new RegExp(id) });
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.clearAllMocks();
  feeds.clear();
  vi.useFakeTimers();
  localStorage.setItem(LIVE_WINDOWS_KEY, 'untouched');
  // Most cases exercise the wall that opens windows by itself (off by default).
  localStorage.setItem('thinker.liveWall.prefs', JSON.stringify({ autoShow: true }));
  mockGetLiveGlance.mockResolvedValue({ items: [] });
});
afterEach(() => vi.useRealTimers());

describe('LiveAgents wall', () => {
  it('opens a tile per running session, marks ended ones and drops them after the grace period', async () => {
    mockGetSessions.mockResolvedValue(running('s1', 's2'));
    render(<LiveAgents createFeed={makeFeed} />);
    await tick(0);
    expect(mockGetSessions).toHaveBeenCalledWith(expect.objectContaining({ running: 'true' }));
    expect(tile('s1')).toBeTruthy();
    expect(tile('s2')).toBeTruthy();
    expect(screen.getByText('2 shown')).toBeTruthy();

    // s1 stops, s3 starts.
    mockGetSessions.mockResolvedValue(running('s2', 's3'));
    await tick(WALL_POLL_MS);
    expect(tile('s3')).toBeTruthy();
    expect(tile('s1')).toBeTruthy();
    expect(screen.getByText(/^Ended ·/)).toBeTruthy();
    // The ended tile closed its connection.
    expect(feeds.get('s1')!.conn).toBe('closed');
    expect(within(tile('s1')!).queryByText(/Connection lost/)).toBeNull();
    expect(screen.getByText('3 shown')).toBeTruthy();

    await tick(WALL_GRACE_MS);
    expect(tile('s1')).toBeNull();
    expect(feeds.get('s1')!.dispose).toHaveBeenCalled();
    expect(feeds.get('s2')!.dispose).not.toHaveBeenCalled();
    expect(localStorage.getItem(LIVE_WINDOWS_KEY)).toBe('untouched');
  });

  it('keeps a pinned tile after its session ends, and a closed one stays closed', async () => {
    mockGetSessions.mockResolvedValue(running('s1', 's2'));
    render(<LiveAgents createFeed={makeFeed} />);
    await tick(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep this tile open' })[0]!);
    fireEvent.click(
      screen.getAllByRole('button', { name: /close/i }).find((b) => tile('s2')!.contains(b))!,
    );
    expect(tile('s2')).toBeNull();

    mockGetSessions.mockResolvedValue(running('s2'));
    await tick(WALL_POLL_MS + WALL_GRACE_MS);
    expect(tile('s1')).toBeTruthy();
    expect(tile('s2')).toBeNull();
  });

  it('opens no more tiles than its budget and says how many wait', async () => {
    mockGetSessions.mockResolvedValue(running('s1', 's2', 's3'));
    render(<LiveAgents createFeed={makeFeed} maxTiles={2} />);
    await tick(0);
    expect(screen.getAllByRole('region')).toHaveLength(2);
    expect(screen.getByText('2 shown')).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 not shown' })).toBeTruthy();
  });

  it('shows an empty state when nothing runs', async () => {
    mockGetSessions.mockResolvedValue(running());
    render(<LiveAgents createFeed={makeFeed} />);
    await tick(0);
    expect(screen.getByRole('heading', { name: 'No session running' })).toBeTruthy();
  });

  it('a busy waiting session takes the slot of a settled idle tile', async () => {
    mockGetSessions.mockResolvedValue(running('s1', 's2'));
    render(<LiveAgents createFeed={makeFeed} maxTiles={1} />);
    await tick(0);
    expect(tile('s1')).toBeTruthy();
    expect(tile('s2')).toBeNull();

    // s2 starts a request: s1 is idle but just opened, so it stays a while.
    mockGetSessions.mockResolvedValue(running('s2*', 's1'));
    await tick(WALL_POLL_MS);
    expect(tile('s1')).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 not shown' })).toBeTruthy();

    await tick(WALL_SETTLE_MS);
    expect(tile('s1')).toBeNull();
    expect(tile('s2')).toBeTruthy();
    expect(feeds.get('s1')!.dispose).toHaveBeenCalled();
  });

  it('opens nothing by itself by default: a chip per session, windows on request', async () => {
    localStorage.removeItem('thinker.liveWall.prefs');
    mockGetSessions.mockResolvedValue(running('s1', 's2', 's3'));
    mockGetLiveGlance.mockResolvedValue({
      items: [{ id: 's1', last: 'thinking', streaming: true }],
    });
    render(<LiveAgents createFeed={makeFeed} maxTiles={2} />);
    await tick(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.getByText('0 shown')).toBeTruthy();
    const chip = (id: string) => document.querySelector(`[data-session="${id}"]`) as HTMLElement;
    expect(chip('s1').dataset.kind).toBe('thinking');
    expect(chip('s1').title).toContain('Thinking (streaming)');
    expect(chip('s2').dataset.kind).toBe('idle');

    // A chip opens its session; later polls leave the others closed.
    fireEvent.click(chip('s3'));
    expect(tile('s3')).toBeTruthy();
    // The window opens beside the chip: one cell of gap, middles aligned (never above the wall).
    const win = tile('s3')!.parentElement!;
    expect(parseInt(win.style.left, 10)).toBe(parseInt(chip('s3').style.left, 10) + 48);
    expect(win.style.top).toBe('0px');
    await tick(WALL_POLL_MS * 2);
    expect(screen.getAllByRole('region')).toHaveLength(1);

    // The pill opens the hidden ones up to the budget.
    fireEvent.click(screen.getByRole('button', { name: '2 not shown' }));
    expect(screen.getAllByRole('region')).toHaveLength(2);
    // No free connection left: the next click swaps in the session still hidden.
    const hiddenBefore = ['s1', 's2'].find((id) => !tile(id))!;
    fireEvent.click(screen.getByRole('button', { name: '1 not shown' }));
    expect(tile(hiddenBefore)).toBeTruthy();
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  it('the "show automatically" switch opens the windows and stops opening them', async () => {
    localStorage.removeItem('thinker.liveWall.prefs');
    mockGetSessions.mockResolvedValue(running('s1'));
    render(<LiveAgents createFeed={makeFeed} />);
    await tick(0);
    expect(tile('s1')).toBeNull();
    const toggle = screen.getByRole('switch', { name: 'Show automatically' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await tick(0);
    expect(tile('s1')).toBeTruthy();

    fireEvent.click(toggle);
    mockGetSessions.mockResolvedValue(running('s1', 's2'));
    await tick(WALL_POLL_MS);
    expect(tile('s1')).toBeTruthy();
    expect(tile('s2')).toBeNull();
  });

  it('chips move by drag, and a dragged chip takes twice as long to disappear', async () => {
    localStorage.removeItem('thinker.liveWall.prefs');
    mockGetSessions.mockResolvedValue(running('s1', 's2'));
    render(<LiveAgents createFeed={makeFeed} />);
    await tick(0);
    const chip = (id: string) => document.querySelector(`[data-session="${id}"]`) as HTMLElement;
    const before = chip('s1').style.left;
    fireEvent.pointerDown(chip('s1'), { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 120 });
    fireEvent.pointerUp(window);
    expect(chip('s1').style.left).toBe('132px');
    expect(chip('s1').style.top).toBe('108px');
    expect(before).not.toBe('132px');
    // The drag did not open the window.
    fireEvent.click(chip('s1'));
    expect(tile('s1')).toBeNull();

    // Both sessions stop: the untouched chip goes, the dragged one stays as long again.
    mockGetSessions.mockResolvedValue(running());
    await tick(WALL_POLL_MS);
    expect(chip('s2')).toBeNull();
    expect(chip('s1').className).toContain('wall-chip--gone');
    await tick(WALL_CHIP_LINGER_MS);
    expect(chip('s1')).toBeNull();
  });

  it('links a subagent chip to its main session: line, shared drag, own window', async () => {
    localStorage.removeItem('thinker.liveWall.prefs');
    mockGetSessions.mockResolvedValue(running('s1', 's2'));
    mockGetLiveGlance.mockResolvedValue({
      items: [
        { id: 's1', parentId: null, last: 'tool_call', streaming: false, idleMs: 0 },
        { id: 'c1', parentId: 's1', agentName: 'agent-s1', last: 'thinking', streaming: true },
        // Its main session is not on the wall, or it stopped long ago: no chip.
        { id: 'c2', parentId: 'other', last: 'user', streaming: false },
        { id: 'c3', parentId: 's1', last: 'user', streaming: false, idleMs: 10 * 60_000 },
      ],
    });
    render(<LiveAgents createFeed={makeFeed} />);
    await tick(0);
    const chip = (id: string) => document.querySelector(`[data-session="${id}"]`) as HTMLElement;
    const px = (v: string) => parseInt(v, 10);
    expect(chip('c2')).toBeNull();
    expect(chip('c3')).toBeNull();
    expect(chip('c1').className).toContain('wall-chip--sub');
    // The subagent sits right under its parent; the next session stays beside the parent.
    expect(chip('c1').style.left).toBe(chip('s1').style.left);
    expect(px(chip('c1').style.top)).toBe(px(chip('s1').style.top) + 72);
    expect(px(chip('s2').style.left)).toBe(px(chip('s1').style.left) + 48);
    expect(chip('s2').style.top).toBe(chip('s1').style.top);
    const link = document.querySelector('[data-link="s1>c1"]')!;
    expect(link.getAttribute('class')).toContain('wall-link--live');

    // Hovering a family member dims the others.
    fireEvent.pointerEnter(chip('c1'));
    expect(chip('s2').className).toContain('wall-chip--dim');
    expect(chip('s1').className).not.toContain('wall-chip--dim');
    fireEvent.pointerLeave(chip('c1'));
    expect(chip('s2').className).not.toContain('wall-chip--dim');

    // Dragging the parent takes the subagent along.
    fireEvent.pointerDown(chip('s1'), { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 164 });
    expect(chip('c1').style.left).toBe(chip('s1').style.left);
    fireEvent.pointerUp(window);
    expect(chip('s1').style.top).toBe('156px');
    expect(chip('c1').style.top).toBe('228px');

    // The subagent opens its own window, which survives the next polls.
    fireEvent.click(chip('c1'));
    expect(tile('c1')).toBeTruthy();
    await tick(WALL_POLL_MS * 2);
    expect(tile('c1')).toBeTruthy();
    expect(within(tile('c1')!).queryByText(/^Ended/)).toBeNull();
    expect(tile('c1')!.parentElement!.className).not.toContain('opacity-70');
  });

  it('a tile the user just touched is not replaced', async () => {
    mockGetSessions.mockResolvedValue(running('s1', 's2'));
    render(<LiveAgents createFeed={makeFeed} maxTiles={1} />);
    await tick(WALL_SETTLE_MS);
    fireEvent.pointerDown(tile('s1')!);
    mockGetSessions.mockResolvedValue(running('s2*', 's1'));
    await tick(WALL_POLL_MS * 2);
    expect(tile('s1')).toBeTruthy();
    await tick(WALL_TOUCH_MS);
    expect(tile('s1')).toBeNull();
    expect(tile('s2')).toBeTruthy();
  });
});

const ses = (id: string, inFlight: number, lastAt: number) => ({
  id,
  agent_name: null,
  in_flight: inFlight,
  last_at: new Date(lastAt).toISOString(),
});
const ids = (tiles: { id: string; endedAt: number | null }[]) =>
  tiles.map((t) => (t.endedAt == null ? t.id : `${t.id}(ended)`));

describe('reconcileWall', () => {
  const none = new Set<string>();

  it('returns the same list when nothing changed', () => {
    const run = [ses('a', 0, 0)];
    const prev = reconcileWall([], run, { dismissed: none, now: 0 });
    expect(reconcileWall(prev, run, { dismissed: none, now: 1 })).toBe(prev);
  });

  it('fills the slots by priority: in flight first, then the latest activity', () => {
    const run = [ses('old', 0, 1), ses('new', 0, 5), ses('busy', 2, 0)];
    expect(ids(reconcileWall([], run, { dismissed: none, now: 0, maxTiles: 2 }))).toEqual([
      'busy',
      'new',
    ]);
  });

  it('an ended tile in its grace period holds no slot', () => {
    const first = reconcileWall([], [ses('a', 0, 3), ses('b', 0, 2)], {
      dismissed: none,
      now: 0,
      maxTiles: 2,
    });
    const next = reconcileWall(first, [ses('b', 0, 2), ses('c', 0, 1)], {
      dismissed: none,
      now: 1,
      maxTiles: 2,
    });
    expect(ids(next)).toEqual(['a(ended)', 'b', 'c']);
  });

  it('keeps a pinned tile even when it falls out of the top', () => {
    const first = reconcileWall([], [ses('a', 0, 1)], { dismissed: none, now: 0, maxTiles: 1 });
    const pinned = [{ ...first[0]!, pinned: true }];
    const next = reconcileWall(pinned, [ses('b', 1, 9), ses('a', 0, 1)], {
      dismissed: none,
      now: 60_000,
      maxTiles: 1,
    });
    expect(ids(next)).toEqual(['a']);
  });

  it('does not flap: a tile busy less than WALL_SETTLE_MS ago keeps its slot', () => {
    const first = reconcileWall([], [ses('a', 1, 5)], { dismissed: none, now: 0, maxTiles: 1 });
    // a went idle at 20 s; b is busy and newer.
    const t1 = reconcileWall(first, [ses('a', 1, 5)], {
      dismissed: none,
      now: 20_000,
      maxTiles: 1,
    });
    const run = [ses('b', 1, 9), ses('a', 0, 5)];
    const t2 = reconcileWall(t1, run, {
      dismissed: none,
      now: 20_000 + WALL_SETTLE_MS - 1,
      maxTiles: 1,
    });
    expect(ids(t2)).toEqual(['a']);
    const t3 = reconcileWall(t2, run, {
      dismissed: none,
      now: 20_000 + WALL_SETTLE_MS,
      maxTiles: 1,
    });
    expect(ids(t3)).toEqual(['b']);
  });

  it('never releases a tile whose session has a request in flight', () => {
    const first = reconcileWall([], [ses('a', 1, 0)], { dismissed: none, now: 0, maxTiles: 1 });
    const next = reconcileWall(first, [ses('b', 1, 9), ses('a', 1, 0)], {
      dismissed: none,
      now: 60_000,
      maxTiles: 1,
    });
    expect(ids(next)).toEqual(['a']);
  });
});

describe('readWallPrefs', () => {
  it('falls back to the defaults on missing or broken data', () => {
    expect(readWallPrefs(null)).toEqual(DEFAULT_WALL_PREFS);
    expect(readWallPrefs('{bad')).toEqual(DEFAULT_WALL_PREFS);
  });

  it('keeps valid fields and clamps or drops the rest', () => {
    const p = readWallPrefs(
      JSON.stringify({
        winW: 99999,
        winH: 300,
        defaultTab: 'inspector',
        closeAfterAnswerSec: 0,
        closeAfterToolSec: 'x',
      }),
    );
    expect(p).toEqual({
      winW: 1200,
      winH: 300,
      defaultTab: 'inspector',
      closeAfterAnswerSec: 0,
      closeAfterToolSec: DEFAULT_WALL_PREFS.closeAfterToolSec,
      autoShow: false,
    });
  });
});

describe('chipLinkPoints', () => {
  const at = (x: number, y: number) => ({ x, y });

  it('side by side: one horizontal line between the facing edges', () => {
    expect(chipLinkPoints(at(12, 12), at(60, 12))).toEqual([
      [36, 36],
      [60, 36],
    ]);
    expect(chipLinkPoints(at(60, 12), at(12, 12))).toEqual([
      [60, 36],
      [36, 36],
    ]);
  });

  it('one above the other: one vertical line', () => {
    expect(chipLinkPoints(at(12, 12), at(12, 84))).toEqual([
      [24, 60],
      [24, 84],
    ]);
    // From the lower one up to the upper one.
    expect(chipLinkPoints(at(12, 84), at(12, 12))).toEqual([
      [24, 84],
      [24, 60],
    ]);
  });

  it('far apart on the same row: over the free row above, both by the top', () => {
    expect(chipLinkPoints(at(12, 84), at(156, 84))).toEqual([
      [24, 84],
      [24, 72],
      [168, 72],
      [168, 84],
    ]);
  });

  it('next row: out of the bottom, along the free row between them, into the top', () => {
    expect(chipLinkPoints(at(12, 12), at(156, 84))).toEqual([
      [24, 60],
      [24, 72],
      [168, 72],
      [168, 84],
    ]);
  });

  it('rows in between: down the free column beside the lower chip', () => {
    expect(chipLinkPoints(at(12, 12), at(156, 156))).toEqual([
      [24, 60],
      [24, 72],
      [144, 72],
      [144, 144],
      [168, 144],
      [168, 156],
    ]);
  });
});
