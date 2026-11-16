import { describe, expect, it, vi } from 'vitest';
import type { LiveAttempt, LiveEvent, LiveEventType } from 'thinker-shared';
import { LiveSessionFeed } from '../../src/services/live-session-feed';

/** A controllable EventSource: tests push frames with `emit`. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  listeners = new Map<string, Array<(e: MessageEvent | Event) => void>>();
  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent | Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  fire(type: string, e: Event | MessageEvent = new Event(type)) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  open() {
    this.readyState = 1;
    this.fire('open');
  }
  emit(ev: LiveEvent) {
    this.fire(ev.type, new MessageEvent(ev.type, { data: JSON.stringify(ev) }));
  }
}

const ES = FakeEventSource as unknown as typeof EventSource;
const lastES = () => FakeEventSource.instances.at(-1)!;

let id = 0;
const ev = (type: LiveEventType, data: Record<string, unknown>): LiveEvent => ({
  id: ++id,
  type,
  ts: 1_000 + id * 10,
  data,
});
const a1 = { requestId: 'r1', attemptId: 'r1.1' };

function session(): LiveEvent[] {
  id = 0;
  return [
    ev('message.appended', { seq: 0, role: 'user', text: 'hi' }),
    ev('request.started', { ...a1, attempt: 1, model: 'm', provider: 'P' }),
    ev('block.started', { ...a1, index: 0, type: 'text' }),
    ev('block.delta', { ...a1, index: 0, delta: 'Hel' }),
    ev('block.delta', { ...a1, index: 0, delta: 'lo' }),
    ev('block.stopped', { ...a1, index: 0 }),
    ev('request.completed', { ...a1, stopReason: 'end_turn', costUsd: 0.1 }),
  ];
}

const snapshot = (lastId: number, items: unknown[] = []): LiveEvent => ({
  id: lastId,
  type: 'snapshot',
  ts: 5_000,
  data: {
    session: { sessionId: 's1', agentName: 'my-harness', harness: 'claude-code' },
    state: {
      lastEventId: lastId,
      lastTs: 5_000,
      items,
      totals: { requests: 0, input: 0, output: 0, costUsd: 0 },
    },
  },
});

describe('LiveSessionFeed', () => {
  it('connects to the live endpoint and applies events with the shared reducer', () => {
    const feed = new LiveSessionFeed('s1', { live: true, EventSource: ES });
    const listener = vi.fn();
    feed.subscribe(listener);
    feed.open();
    const es = lastES();
    expect(es.url).toBe('/api/v1/sessions/s1/live');
    expect(es.init).toEqual({ withCredentials: true });
    expect(feed.conn).toBe('connecting');

    es.open();
    es.emit(snapshot(0));
    for (const e of session()) es.emit(e);
    feed.flush();

    expect(feed.conn).toBe('open');
    expect(feed.session?.agentName).toBe('my-harness');
    expect(feed.state.lastEventId).toBe(7);
    const attempt = feed.state.items[1] as LiveAttempt;
    expect(attempt.status).toBe('done');
    expect(attempt.blocks[0]!.text).toBe('Hello');
    expect(feed.liveLog).toHaveLength(7);
    expect(listener).toHaveBeenCalled();
    feed.dispose();
    expect(es.closed).toBe(true);
  });

  it('batches renders and ignores events it already has (replay after a reconnect)', () => {
    const feed = new LiveSessionFeed('s1', { live: true, EventSource: ES });
    feed.open();
    const es = lastES();
    const events = session();
    es.emit(snapshot(0));
    for (const e of events.slice(0, 4)) es.emit(e);
    const v = feed.version;
    // A network drop: the browser reconnects with Last-Event-ID and may replay overlap.
    es.fire('error');
    expect(feed.conn).toBe('reconnecting');
    for (const e of events.slice(2)) es.emit(e);
    feed.flush();
    expect(feed.version).toBe(v + 1);
    expect(feed.conn).toBe('open');
    expect((feed.state.items[1] as LiveAttempt).blocks[0]!.text).toBe('Hello');
    feed.dispose();
  });

  it('reports a 404 and a 429 after the browser gives up', async () => {
    for (const [status, error] of [
      [404, 'not_found'],
      [429, 'too_many'],
    ] as const) {
      const fetchMock = vi.fn(async () => new Response('', { status }));
      const feed = new LiveSessionFeed('s1', { live: true, EventSource: ES, fetch: fetchMock });
      feed.open();
      const es = lastES();
      es.readyState = 2;
      es.fire('error');
      await vi.waitFor(() => expect(feed.error).toBe(error));
      expect(feed.conn).toBe('closed');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/sessions/s1/live',
        expect.objectContaining({ credentials: 'include' }),
      );
      feed.dispose();
    }
  });

  it('retries with ?lastEventId after a server error', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => new Response('', { status: 502 }));
      const feed = new LiveSessionFeed('s1', { live: true, EventSource: ES, fetch: fetchMock });
      feed.open();
      const es = lastES();
      es.emit(snapshot(0));
      for (const e of session().slice(0, 3)) es.emit(e);
      es.readyState = 2;
      es.fire('error');
      await vi.advanceTimersByTimeAsync(3_100);
      expect(lastES()).not.toBe(es);
      expect(lastES().url).toBe('/api/v1/sessions/s1/live?lastEventId=3');
      expect(feed.error).toBeNull();
      feed.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads history lazily in pages and merges the live events after it', async () => {
    const events = session();
    const loadPage = vi.fn(async (_id: string, p: { after?: number; until?: number }) => {
      const page = events
        .filter((e) => e.id > (p.after ?? 0) && e.id <= (p.until ?? 99))
        .slice(0, 2);
      const last = page.at(-1)?.id ?? null;
      return {
        session: { sessionId: 's1', agentName: null, harness: null },
        events: page,
        next_after: last != null && last < (p.until ?? 99) ? last : null,
      };
    });
    const feed = new LiveSessionFeed('s1', { live: true, EventSource: ES, loadPage });
    feed.open();
    const es = lastES();
    // Joined after event 5: the snapshot carries the state, the log only what follows.
    const state5 = (await import('thinker-shared')).reduceLiveEvents(events.slice(0, 5));
    es.emit(snapshot(5, state5.items));
    es.emit(events[5]!);
    expect(feed.history).toBeNull();
    expect(loadPage).not.toHaveBeenCalled();

    const p = feed.ensureHistory();
    es.emit(events[6]!); // arrives while history loads
    await p;
    expect(loadPage.mock.calls.map((c) => c[1].after)).toEqual([0, 2, 4]);
    expect(loadPage.mock.calls[0]![1].until).toBe(6);
    expect(feed.history!.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(feed.historyStatus).toBe('ready');

    // Replay positions rebuild the state from history.
    expect((feed.stateAt(4).items[1] as LiveAttempt).blocks[0]!.text).toBe('Hel');
    expect(feed.lastEventOfRequest('r1')).toBe(7);
    feed.dispose();
  });

  it('a finished session works from history alone, without SSE', async () => {
    const events = session();
    const before = FakeEventSource.instances.length;
    const loadPage = vi.fn(async () => ({
      session: { sessionId: 's1', agentName: 'h', harness: null },
      events,
      next_after: null,
    }));
    const feed = new LiveSessionFeed('s1', { live: false, EventSource: ES, loadPage });
    feed.open();
    await vi.waitFor(() => expect(feed.historyStatus).toBe('ready'));
    expect(FakeEventSource.instances.length).toBe(before);
    expect(feed.state.lastEventId).toBe(7);
    expect(feed.session?.agentName).toBe('h');
    expect(feed.conn).toBe('closed');
    feed.dispose();
  });
});
