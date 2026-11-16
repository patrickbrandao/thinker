import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BridgeClient,
  BridgeHost,
  loadPageVia,
  type BridgeChannel,
  type ChannelFactory,
} from '../../../src/pages/lab/live-agents-bridge';
import { Fleet } from '../../../src/pages/lab/live-agents-sim';
import { LIVE_EVENT_TYPES, LiveSessionFeed } from '../../../src/services/live-session-feed';

/** BroadcastChannel test double: delivers a copy to the other channels of the same name. */
class Hub {
  readonly channels = new Set<FakeChannel>();
  sent = 0;
  factory: ChannelFactory = (name) => new FakeChannel(this, name);
}

class FakeChannel implements BridgeChannel {
  private listeners = new Set<(ev: MessageEvent) => void>();
  closed = false;
  constructor(
    private readonly hub: Hub,
    readonly name: string,
  ) {
    hub.channels.add(this);
  }
  postMessage(message: unknown) {
    if (this.closed) throw new Error('closed');
    this.hub.sent += 1;
    const data = JSON.parse(JSON.stringify(message)) as unknown;
    for (const c of this.hub.channels)
      if (c !== this && c.name === this.name)
        void Promise.resolve().then(() => {
          if (!c.closed) for (const fn of [...c.listeners]) fn({ data } as MessageEvent);
        });
  }
  addEventListener(_type: 'message', fn: (ev: MessageEvent) => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_type: 'message', fn: (ev: MessageEvent) => void) {
    this.listeners.delete(fn);
  }
  close() {
    this.closed = true;
    this.hub.channels.delete(this);
  }
}

let hub: Hub;
let fleet: Fleet;
const cleanup: { dispose: () => void }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  hub = new Hub();
});
afterEach(() => {
  for (const c of cleanup.splice(0)) c.dispose();
  fleet?.dispose();
  vi.useRealTimers();
});

const track = <T extends { dispose: () => void }>(x: T) => (cleanup.push(x), x);

async function startFleet(speed = 1) {
  fleet = new Fleet({ agents: 1, speed, fallbackPct: 0, cutPct: 0 }, { autoStart: false });
  fleet.start();
  await vi.advanceTimersByTimeAsync(1500);
  return [...fleet.sessions.keys()][0]!;
}

const feedOver = (client: BridgeClient, id: string) =>
  track(
    new LiveSessionFeed(id, {
      live: true,
      EventSource: client.EventSource,
      fetch: client.fetch,
      loadPage: loadPageVia(client.fetch),
    }),
  );

describe('Live agents lab: BroadcastChannel bridge', () => {
  it('answers a stream request with the snapshot, then the live events', async () => {
    const id = await startFleet();
    track(new BridgeHost(fleet, { channel: hub.factory }));
    const client = track(new BridgeClient({ channel: hub.factory }));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status).toBe('up');

    const feed = feedOver(client, id);
    const receive = vi.spyOn(feed, 'receive');
    feed.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(receive.mock.calls[0]![0].type).toBe('snapshot');
    expect(feed.session).toMatchObject({ sessionId: id });
    const atSnapshot = feed.state.lastEventId;
    expect(atSnapshot).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(3000);
    expect(receive.mock.calls.length).toBeGreaterThan(1);
    expect(receive.mock.calls.slice(1).every(([ev]) => ev.type !== 'snapshot')).toBe(true);
    expect(feed.state.lastEventId).toBeGreaterThan(atSnapshot);
    expect(feed.conn).toBe('open');
    expect(fleet.stats().liveConnections).toBe(1);

    // History for the replay bar goes through the bridged fetch.
    await feed.ensureHistory();
    expect(feed.historyStatus).toBe('ready');
    expect(feed.history![0]!.id).toBe(1);

    feed.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(fleet.stats().liveConnections).toBe(0);
  });

  it('replays only the missed events for a lastEventId join', async () => {
    const id = await startFleet();
    await vi.advanceTimersByTimeAsync(1500);
    track(new BridgeHost(fleet, { channel: hub.factory }));
    const client = track(new BridgeClient({ channel: hub.factory }));
    await vi.advanceTimersByTimeAsync(0);
    const got: number[] = [];
    const es = new client.EventSource(`/api/v1/sessions/${id}/live?lastEventId=2`);
    for (const type of LIVE_EVENT_TYPES.filter((x) => x !== 'snapshot'))
      es.addEventListener(type, (e) =>
        got.push((JSON.parse((e as MessageEvent).data as string) as { id: number }).id),
      );
    es.addEventListener('snapshot', () => got.push(-1));
    await vi.advanceTimersByTimeAsync(0);
    es.close();
    expect(got.length).toBeGreaterThan(0);
    expect(got).not.toContain(-1);
    expect(got.every((n) => n > 2)).toBe(true);
  });

  it('serves several watch tabs at once', async () => {
    const id = await startFleet();
    track(new BridgeHost(fleet, { channel: hub.factory }));
    const a = feedOver(track(new BridgeClient({ channel: hub.factory })), id);
    const b = feedOver(track(new BridgeClient({ channel: hub.factory })), id);
    await vi.advanceTimersByTimeAsync(0);
    a.open();
    b.open();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fleet.stats().liveConnections).toBe(2);
    expect(a.state.lastEventId).toBe(b.state.lastEventId);
    expect(a.state.lastEventId).toBeGreaterThan(0);
  });

  it('reports a lost host, then resumes with lastEventId when it is back', async () => {
    const id = await startFleet();
    const host = new BridgeHost(fleet, { channel: hub.factory });
    const client = track(new BridgeClient({ channel: hub.factory }));
    const feed = feedOver(client, id);
    const receive = vi.spyOn(feed, 'receive');
    await vi.advanceTimersByTimeAsync(0);
    feed.open();
    await vi.advanceTimersByTimeAsync(1000);
    const before = feed.state.lastEventId;

    host.dispose(); // the lab tab closes: `bye`
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status).toBe('lost');
    expect(feed.conn).toBe('reconnecting');
    expect(fleet.stats().liveConnections).toBe(0);
    await vi.advanceTimersByTimeAsync(7000);
    expect(client.status).toBe('lost');
    expect(feed.error).toBeNull();

    // The same simulation answers again (a frozen tab, or the host restarted).
    track(new BridgeHost(fleet, { channel: hub.factory }));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status).toBe('up');
    receive.mockClear();
    await vi.advanceTimersByTimeAsync(4000);
    expect(feed.conn).toBe('open');
    expect(receive.mock.calls.length).toBeGreaterThan(0);
    // Resumed after the last event it had: no second snapshot.
    expect(receive.mock.calls.every(([ev]) => ev.type !== 'snapshot')).toBe(true);
    expect(receive.mock.calls[0]![0].id).toBeGreaterThan(before - 1);
  });

  it('marks the host lost when nobody answers within 2 s, and notices a silent host', async () => {
    const lonely = track(new BridgeClient({ channel: hub.factory }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(lonely.status).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(lonely.status).toBe('lost');
    await expect(lonely.fetch('/api/v1/agents')).rejects.toThrow();

    await startFleet();
    const host = track(new BridgeHost(fleet, { channel: hub.factory }));
    await vi.advanceTimersByTimeAsync(0);
    expect(lonely.status).toBe('up');
    // The host tab freezes or crashes without a goodbye: its channel goes quiet.
    (host as unknown as { ch: FakeChannel }).ch.close();
    await vi.advanceTimersByTimeAsync(3500);
    expect(lonely.status).toBe('lost');
  });

  it('picks the lab tab that has the session when several are open', async () => {
    const other = new Fleet({ agents: 1 }, { autoStart: false });
    track(other);
    track(new BridgeHost(other, { channel: hub.factory }));
    const id = await startFleet();
    track(new BridgeHost(fleet, { channel: hub.factory }));
    const client = track(new BridgeClient({ channel: hub.factory, sessionId: id }));
    const feed = feedOver(client, id);
    feed.open();
    await vi.advanceTimersByTimeAsync(1500);
    expect(feed.error).toBeNull();
    expect(feed.conn).toBe('open');
    expect(feed.state.lastEventId).toBeGreaterThan(0);
  });

  it('a reloaded lab (new fleet) leaves the session not found', async () => {
    const id = await startFleet();
    const host = new BridgeHost(fleet, { channel: hub.factory });
    const client = track(new BridgeClient({ channel: hub.factory }));
    const feed = feedOver(client, id);
    await vi.advanceTimersByTimeAsync(0);
    feed.open();
    await vi.advanceTimersByTimeAsync(500);
    host.dispose();
    fleet.dispose();
    fleet = new Fleet({ agents: 1 }, { autoStart: false });
    track(new BridgeHost(fleet, { channel: hub.factory }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.status).toBe('up');
    expect(feed.error).toBe('not_found');
  });

  it('ends on not found after a real lab reload, whatever the message order', async () => {
    // A stray lab tab (another simulation) keeps answering pings.
    const stray = track(new Fleet({ agents: 1 }, { autoStart: false }));
    track(new BridgeHost(stray, { channel: hub.factory }));
    fleet = new Fleet(
      { agents: 1, speed: 1, turns: 20, fallbackPct: 0, cutPct: 0 },
      { autoStart: false },
    );
    fleet.start();
    await vi.advanceTimersByTimeAsync(1500);
    const id = [...fleet.sessions.keys()][0]!;
    const old = new BridgeHost(fleet, { channel: hub.factory });
    const client = track(new BridgeClient({ channel: hub.factory, sessionId: id }));
    const feed = feedOver(client, id);
    feed.open();
    await vi.advanceTimersByTimeAsync(2000);
    expect(feed.conn).toBe('open');

    // Reload: pagehide says bye, but the dying page still answers a ping or two.
    const oldCh = (old as unknown as { ch: FakeChannel }).ch;
    oldCh.postMessage({ t: 'bye', host: old.id });
    await vi.advanceTimersByTimeAsync(1000);
    oldCh.close();
    // The reloaded lab: StrictMode mounts a host, disposes it, mounts another.
    const fresh = track(new Fleet({ agents: 1 }, { autoStart: false }));
    new BridgeHost(fresh, { channel: hub.factory }).dispose();
    track(new BridgeHost(fresh, { channel: hub.factory }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(feed.error).toBe('not_found');
    expect(feed.conn).toBe('closed');
  });

  it('never goes back to a lab tab that said goodbye, even if it still answers', async () => {
    const id = await startFleet();
    fleet.configure({ turns: 20 });
    const old = new BridgeHost(fleet, { channel: hub.factory });
    const client = track(new BridgeClient({ channel: hub.factory, sessionId: id }));
    const feed = feedOver(client, id);
    feed.open();
    await vi.advanceTimersByTimeAsync(1500);
    expect(feed.conn).toBe('open');
    // Reload where the old page outlives its pagehide (it keeps answering pings
    // with has=true, as seen in the browser), while the reloaded lab mounts.
    const oldCh = (old as unknown as { ch: FakeChannel }).ch;
    oldCh.postMessage({ t: 'bye', host: old.id });
    const fresh = track(new Fleet({ agents: 1 }, { autoStart: false }));
    new BridgeHost(fresh, { channel: hub.factory }).dispose();
    track(new BridgeHost(fresh, { channel: hub.factory }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(client.host).not.toBe(old.id);
    expect(feed.error).toBe('not_found');
    expect(feed.conn).toBe('closed');
    old.dispose();
  });

  it('tells the watch tab when the session ends', async () => {
    const id = await startFleet(20);
    track(new BridgeHost(fleet, { channel: hub.factory }));
    const client = track(new BridgeClient({ channel: hub.factory }));
    const feed = feedOver(client, id);
    await vi.advanceTimersByTimeAsync(0);
    feed.open();
    for (let i = 0; i < 400 && !client.ended.has(id); i++) await vi.advanceTimersByTimeAsync(500);
    expect(client.ended.has(id)).toBe(true);
    expect(fleet.sessions.get(id)!.endedAt).not.toBeNull();
  });
});
