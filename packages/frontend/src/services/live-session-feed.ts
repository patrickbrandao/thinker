/**
 * The browser side of a session's live feed, one per open live-session window
 * (docs/dev/janela-sessao-ao-vivo.md). It listens to `GET /sessions/:id/live`
 * over an EventSource, applies each event to a mutable state with the shared
 * reducer, and batches React renders to one per animation frame. The replay
 * bar reads the session's history from `GET /sessions/:id/events`, loaded
 * lazily. A finished session (replay mode) works from history alone.
 */
import { useSyncExternalStore } from 'react';
import {
  applyLiveEvent,
  emptyLiveState,
  reduceLiveEvents,
  type LiveEvent,
  type LiveEventType,
  type LiveSessionMeta,
  type LiveState,
} from 'thinker-shared';
import { getSessionEvents, sessionLiveUrl } from './api/sessions.js';
import { withOrganizationHeader } from './org-context.js';

export type ConnState = 'connecting' | 'open' | 'reconnecting' | 'closed';
export type FeedError = 'not_found' | 'too_many' | null;
export type HistoryStatus = 'idle' | 'loading' | 'ready' | 'error';

export const LIVE_EVENT_TYPES: readonly LiveEventType[] = [
  'snapshot',
  'message.appended',
  'conversation.reset',
  'request.started',
  'block.started',
  'block.delta',
  'block.stopped',
  'request.completed',
  'request.failed',
  'request.cancelled',
];

const HISTORY_PAGE = 1000;
const RETRY_MS = 3000;

export interface LiveFeedOptions {
  /** false: a finished session, rebuilt from history only (no SSE). */
  live: boolean;
  /** Injection points for tests. */
  EventSource?: typeof EventSource;
  fetch?: typeof fetch;
  loadPage?: typeof getSessionEvents;
}

function parseEvent(raw: string): LiveEvent | null {
  try {
    const ev = JSON.parse(raw) as LiveEvent;
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') return null;
    if (typeof ev.id !== 'number' || !ev.data || typeof ev.data !== 'object') return null;
    return ev;
  } catch {
    return null;
  }
}

export class LiveSessionFeed {
  state: LiveState = emptyLiveState();
  session: LiveSessionMeta | null = null;
  conn: ConnState = 'closed';
  error: FeedError = null;
  /** Bumped on every batched update (the useSyncExternalStore snapshot). */
  version = 0;
  /** Full event list once loaded (live events keep being appended to it). */
  history: LiveEvent[] | null = null;
  historyStatus: HistoryStatus = 'idle';
  /** Events received over SSE since the last snapshot, while history is not loaded. */
  liveLog: LiveEvent[] = [];
  readonly live: boolean;

  private es: EventSource | null = null;
  private listeners = new Set<() => void>();
  private raf = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private historyPromise: Promise<void> | null = null;
  private opened = false;
  private readonly ES: typeof EventSource | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly loadPage: typeof getSessionEvents;

  constructor(
    readonly sessionId: string,
    opts: LiveFeedOptions,
  ) {
    this.live = opts.live;
    this.ES = opts.EventSource ?? (typeof EventSource === 'undefined' ? undefined : EventSource);
    this.fetchImpl = opts.fetch ?? (typeof fetch === 'undefined' ? undefined : fetch);
    this.loadPage = opts.loadPage ?? getSessionEvents;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  /** Runs the pending render now (tests, and the end of a burst). */
  flush = () => {
    if (this.raf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
      else clearTimeout(this.raf);
    }
    this.raf = 0;
    this.version += 1;
    for (const l of [...this.listeners]) l();
  };

  private schedule() {
    if (this.raf) return;
    this.raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(this.flush)
        : (setTimeout(this.flush, 16) as unknown as number);
  }

  /** Starts the feed: the SSE connection, or the history of a finished session. */
  open() {
    if (this.opened) return;
    this.opened = true;
    this.error = null;
    if (this.live) this.connect(null);
    else void this.ensureHistory();
    this.schedule();
  }

  /** The window closed: drop the connection and any pending retry. */
  close() {
    this.opened = false;
    this.es?.close();
    this.es = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.conn = 'closed';
    this.schedule();
  }

  dispose() {
    this.close();
    if (this.raf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
      else clearTimeout(this.raf);
    }
    this.raf = 0;
    this.listeners.clear();
  }

  /** Try again after a permanent failure (429, or the user pressed Retry). */
  reconnect() {
    if (!this.live) {
      this.historyStatus = 'idle';
      this.historyPromise = null;
      void this.ensureHistory();
      return;
    }
    this.close();
    this.open();
  }

  private connect(lastEventId: number | null) {
    if (!this.ES) {
      this.conn = 'closed';
      return;
    }
    this.conn = lastEventId == null ? 'connecting' : 'reconnecting';
    const es = new this.ES(sessionLiveUrl(this.sessionId, lastEventId), {
      withCredentials: true,
    });
    this.es = es;
    const onMessage = (msg: MessageEvent) => {
      if (this.es !== es) return;
      const ev = typeof msg.data === 'string' ? parseEvent(msg.data) : null;
      if (ev) this.receive(ev);
    };
    for (const type of LIVE_EVENT_TYPES) es.addEventListener(type, onMessage as EventListener);
    // A server that leaves out the `event:` line still delivers the JSON.
    es.addEventListener('message', onMessage as EventListener);
    es.addEventListener('open', () => {
      if (this.es !== es) return;
      this.conn = 'open';
      this.schedule();
    });
    es.addEventListener('error', () => {
      if (this.es !== es) return;
      if (es.readyState === 2) {
        // The browser gave up (HTTP error or wrong content type): find out why.
        es.close();
        this.es = null;
        this.conn = 'reconnecting';
        this.schedule();
        void this.diagnose();
      } else {
        // Network drop: EventSource reconnects by itself with Last-Event-ID.
        this.conn = 'reconnecting';
        this.schedule();
      }
    });
  }

  /** After a permanent EventSource failure: 404 and 429 stop, anything else retries. */
  private async diagnose() {
    let status = 0;
    if (this.fetchImpl) {
      const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
      try {
        const headers = withOrganizationHeader({ Accept: 'text/event-stream' });
        const res = await this.fetchImpl(sessionLiveUrl(this.sessionId, this.state.lastEventId), {
          credentials: 'include',
          ...(headers ? { headers } : {}),
          ...(ctrl ? { signal: ctrl.signal } : {}),
        });
        status = res.status;
      } catch {
        status = 0;
      } finally {
        ctrl?.abort();
      }
    }
    if (!this.opened) return;
    if (status === 404 || status === 403) {
      this.error = 'not_found';
      this.conn = 'closed';
    } else if (status === 429) {
      this.error = 'too_many';
      this.conn = 'closed';
    } else {
      this.retry = setTimeout(() => {
        this.retry = null;
        if (this.opened && !this.es) this.connect(this.state.lastEventId || null);
      }, RETRY_MS);
    }
    this.schedule();
  }

  /** Applies one event from the wire (exposed for tests). */
  receive(ev: LiveEvent) {
    if (ev.type === 'snapshot') {
      const data = ev.data as { session?: LiveSessionMeta };
      if (data.session) this.session = data.session;
      // A fresh state: history merged earlier may now have a gap, so reload it on demand.
      this.state = emptyLiveState();
      applyLiveEvent(this.state, ev);
      this.liveLog = [];
      if (this.historyStatus === 'ready') {
        this.history = null;
        this.historyStatus = 'idle';
        this.historyPromise = null;
      }
    } else {
      // Replayed events after a reconnect may overlap what we already have.
      if (ev.id <= this.state.lastEventId) return;
      applyLiveEvent(this.state, ev);
      if (this.history) this.history.push(ev);
      else this.liveLog.push(ev);
    }
    this.conn = 'open';
    this.error = null;
    this.schedule();
  }

  /**
   * Loads the session's events for the replay bar, once. In live mode the
   * events received over SSE since the snapshot are merged after the history.
   */
  ensureHistory(): Promise<void> {
    if (this.historyStatus === 'ready') return Promise.resolve();
    if (this.historyPromise) return this.historyPromise;
    this.historyStatus = 'loading';
    this.schedule();
    const until = this.live && this.state.lastEventId > 0 ? this.state.lastEventId : undefined;
    this.historyPromise = this.loadAll(until)
      .then((events) => {
        const lastLoaded = events.at(-1)?.id ?? 0;
        const merged = [...events, ...this.liveLog.filter((e) => e.id > lastLoaded)];
        this.history = merged;
        this.liveLog = [];
        this.historyStatus = 'ready';
        if (!this.live) {
          this.state = reduceLiveEvents(merged);
          this.conn = 'closed';
        }
      })
      .catch((err: unknown) => {
        this.historyStatus = 'error';
        this.historyPromise = null;
        if (!this.live && err instanceof Error && /404|not found/i.test(err.message))
          this.error = 'not_found';
      })
      .finally(() => this.schedule());
    return this.historyPromise;
  }

  private async loadAll(until?: number): Promise<LiveEvent[]> {
    const out: LiveEvent[] = [];
    let after: number | undefined = 0;
    // Guard against a server that never ends the pagination.
    for (let page = 0; page < 1000 && after != null; page++) {
      const res = await this.loadPage(this.sessionId, { after, until, limit: HISTORY_PAGE });
      if (res.session && !this.session) this.session = res.session;
      for (const ev of res.events ?? []) if (ev.id > (out.at(-1)?.id ?? 0)) out.push(ev);
      const next: number | null = res.next_after ?? null;
      after = next != null && next > (after ?? 0) ? next : undefined;
    }
    return out;
  }

  /** Events known so far, oldest first: the history when loaded, else the live log. */
  timeline(): LiveEvent[] {
    return this.history ?? this.liveLog;
  }

  /** The state at event `id` (a replay position), rebuilt from history. */
  stateAt(id: number): LiveState {
    if (!this.history) return this.state;
    return reduceLiveEvents(this.history.filter((e) => e.id <= id));
  }

  /** Id of the last event of a request (its final attempt's outcome), for "Open session". */
  lastEventOfRequest(requestId: string): number | null {
    if (!this.history) return null;
    const attempts = new Set<unknown>();
    let last: number | null = null;
    for (const e of this.history) {
      const d = e.data as { requestId?: unknown; attemptId?: unknown };
      if (e.type === 'request.started' && d.requestId === requestId) attempts.add(d.attemptId);
      if (d.attemptId !== undefined && attempts.has(d.attemptId)) last = e.id;
    }
    return last;
  }
}

/** Re-renders the component on every batched update of the feed. */
export function useLiveFeed(feed: LiveSessionFeed): LiveSessionFeed {
  useSyncExternalStore(feed.subscribe, feed.getVersion, feed.getVersion);
  return feed;
}
