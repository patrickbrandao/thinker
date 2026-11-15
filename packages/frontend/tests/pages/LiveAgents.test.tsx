import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockGetSessions = vi.fn();
vi.mock('../../src/services/api/sessions', async (orig) => ({
  ...(await orig<typeof import('../../src/services/api/sessions')>()),
  getSessions: (...a: unknown[]) => mockGetSessions(...a),
}));
vi.mock('../../src/services/api', () => ({
  getAgents: vi.fn(async () => ({ agents: [] })),
}));

import LiveAgents, {
  reconcileWall,
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
    expect(screen.getByText('2 running')).toBeTruthy();

    // s1 stops, s3 starts.
    mockGetSessions.mockResolvedValue(running('s2', 's3'));
    await tick(WALL_POLL_MS);
    expect(tile('s3')).toBeTruthy();
    expect(tile('s1')).toBeTruthy();
    expect(screen.getByText('Ended')).toBeTruthy();
    // The ended tile closed its connection.
    expect(feeds.get('s1')!.conn).toBe('closed');
    expect(within(tile('s1')!).queryByText(/Connection lost/)).toBeNull();
    expect(screen.getByText('2 running')).toBeTruthy();

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
    expect(screen.getByText('3 running')).toBeTruthy();
    expect(screen.getByText('1 more waiting for a free tile')).toBeTruthy();
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
    expect(screen.getByText('1 more waiting for a free tile')).toBeTruthy();

    await tick(WALL_SETTLE_MS);
    expect(tile('s1')).toBeNull();
    expect(tile('s2')).toBeTruthy();
    expect(feeds.get('s1')!.dispose).toHaveBeenCalled();
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
