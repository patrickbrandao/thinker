/**
 * Lab only: carries the simulated fleet to other tabs over a BroadcastChannel.
 *
 * The simulated sessions live in the memory of the lab tab. The lab tab runs a
 * `BridgeHost` over its `Fleet`; a watch tab (`/lab/live-agents/watch/:id`)
 * runs a `BridgeClient`, whose fake `EventSource` and `fetch` proxy over the
 * channel, so the official `LiveSessionFeed` works there unchanged.
 *
 * Protocol (every message goes to every tab; ids are random, so each tab keeps
 * only its own):
 * - the client pings every second; the host answers `host` (its id). No answer
 *   within 2 s at start, or 3 s later on, or a `bye` from the host (tab closed
 *   or reloaded) means the host is lost. A ping names the session the watch
 *   tab wants and the answer says whether that host has it: with several lab
 *   tabs open, the client binds to the one that has its session (a host
 *   without it gets the requests only after a short grace for the others to
 *   answer) and then sticks to it until it is lost;
 * - `open` a stream for a live URL (with an optional `lastEventId`): the host
 *   answers `opened`, then the snapshot (or the missed events) and the live
 *   events as they come, `fail` when the fleet refuses or forgets the session,
 *   and `ended` when the session finishes; the client sends `close`;
 * - `fetch` a URL of the fleet's fake API, answered by `fetched`.
 * Nothing polls whole state: events are forwarded one by one.
 */
import type { LiveEvent } from 'thinker-shared';
import type { SessionEventsPage } from '../../services/api/sessions.js';
import type { Fleet } from './live-agents-sim.js';

export const LAB_CHANNEL = 'thinker.lab.liveAgents';

/** The part of `BroadcastChannel` the bridge uses (a test double in tests). */
export interface BridgeChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', fn: (ev: MessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (ev: MessageEvent) => void): void;
  close(): void;
}

export type ChannelFactory = (name: string) => BridgeChannel;

const browserChannel: ChannelFactory = (name) => new BroadcastChannel(name);

export type BridgeMessage =
  | { t: 'ping'; client: string; session?: string }
  | { t: 'host'; host: string; has?: boolean }
  | { t: 'bye'; host: string }
  | { t: 'client.bye'; client: string }
  | { t: 'open'; host: string; client: string; stream: string; url: string }
  | { t: 'opened'; host: string; stream: string; ended: boolean }
  | { t: 'event'; stream: string; ev: LiveEvent }
  | { t: 'fail'; stream: string }
  | { t: 'ended'; stream: string }
  | { t: 'close'; stream: string }
  | { t: 'fetch'; host: string; client: string; req: string; url: string }
  | { t: 'fetched'; req: string; status: number; body: string };

const randomId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

const sessionOf = (url: string) => {
  const m = /\/api\/v1\/sessions\/([^/?]+)\/live/.exec(url);
  return m ? decodeURIComponent(m[1]!) : '';
};

// ------------------------------------------------------------------- host

interface HostStream {
  client: string;
  sessionId: string;
  ended: boolean;
  detach: () => void;
}

export interface BridgeHostOptions {
  channel?: ChannelFactory;
  /** A client silent this long (tab closed without a goodbye) loses its streams. */
  clientTimeoutMs?: number;
}

/** The lab tab's side: answers stream and fetch requests from the fleet. */
export class BridgeHost {
  /** Changes when the page comes back from the back/forward cache (clients dropped the old id). */
  id = randomId();
  private readonly ch: BridgeChannel;
  private readonly streams = new Map<string, HostStream>();
  private readonly clients = new Map<string, number>();
  private readonly offFleet: () => void;
  private readonly sweep: ReturnType<typeof setInterval>;
  private readonly clientTimeoutMs: number;
  private disposed = false;

  constructor(
    private readonly fleet: Fleet,
    opts: BridgeHostOptions = {},
  ) {
    this.clientTimeoutMs = opts.clientTimeoutMs ?? 10_000;
    this.ch = (opts.channel ?? browserChannel)(LAB_CHANNEL);
    this.ch.addEventListener('message', this.onMessage);
    this.offFleet = fleet.watch(() => this.checkEnded());
    this.sweep = setInterval(() => this.expire(), 2_000);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      window.addEventListener('pageshow', this.onPageShow);
    }
    // Watch tabs already waiting reconnect without waiting for their next ping.
    this.post({ t: 'host', host: this.id });
  }

  /** Bridged streams open now (they also count in the fleet's connections). */
  get streamCount() {
    return this.streams.size;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.streams.values()) s.detach();
    this.streams.clear();
    this.post({ t: 'bye', host: this.id });
    this.offFleet();
    clearInterval(this.sweep);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      window.removeEventListener('pageshow', this.onPageShow);
    }
    this.ch.removeEventListener('message', this.onMessage);
    this.ch.close();
  }

  /** Leaving: say goodbye and stop answering (a dying page may still get messages). */
  private gone = false;
  private readonly onPageHide = () => {
    this.post({ t: 'bye', host: this.id });
    this.gone = true;
    for (const s of this.streams.values()) s.detach();
    this.streams.clear();
  };
  /** Back from the back/forward cache: clients forgot the old id, so take a new one. */
  private readonly onPageShow = () => {
    if (!this.gone) return;
    this.gone = false;
    this.id = randomId();
    this.post({ t: 'host', host: this.id });
  };

  private post(m: BridgeMessage) {
    if (this.disposed && m.t !== 'bye') return;
    try {
      this.ch.postMessage(m);
    } catch {
      /* channel closed */
    }
  }

  private readonly onMessage = (e: MessageEvent) => {
    const m = e.data as BridgeMessage;
    if (!m || typeof m !== 'object' || this.disposed || this.gone) return;
    switch (m.t) {
      case 'ping':
        this.clients.set(m.client, Date.now());
        this.post({
          t: 'host',
          host: this.id,
          ...(m.session ? { has: this.fleet.sessions.has(m.session) } : {}),
        });
        break;
      case 'open':
        if (m.host !== this.id) return;
        this.clients.set(m.client, Date.now());
        this.open(m.client, m.stream, m.url);
        break;
      case 'close':
        this.close(m.stream);
        break;
      case 'client.bye':
        this.dropClient(m.client);
        break;
      case 'fetch':
        if (m.host === this.id) void this.fetch(m.req, m.url);
        break;
      default:
        break;
    }
  };

  private open(client: string, stream: string, url: string) {
    if (this.streams.has(stream)) return;
    const sessionId = sessionOf(url);
    let failed = false;
    const entry: HostStream = { client, sessionId, ended: false, detach: () => undefined };
    const detach = this.fleet.attach(url, {
      open: () => {
        entry.ended = this.fleet.sessions.get(sessionId)?.endedAt != null;
        this.post({ t: 'opened', host: this.id, stream, ended: entry.ended });
      },
      event: (ev) => this.post({ t: 'event', stream, ev }),
      fail: () => {
        failed = true;
        this.streams.delete(stream);
        this.post({ t: 'fail', stream });
      },
    });
    if (failed) return;
    entry.detach = detach;
    this.streams.set(stream, entry);
  }

  private close(stream: string) {
    const s = this.streams.get(stream);
    if (!s) return;
    s.detach();
    this.streams.delete(stream);
  }

  private dropClient(client: string) {
    this.clients.delete(client);
    for (const [id, s] of this.streams) if (s.client === client) this.close(id);
  }

  /** Forgets clients that went silent (a tab closed without `client.bye`). */
  private expire() {
    const now = Date.now();
    for (const [client, at] of this.clients)
      if (now - at >= this.clientTimeoutMs) this.dropClient(client);
  }

  private checkEnded() {
    for (const [stream, s] of this.streams) {
      if (s.ended || this.fleet.sessions.get(s.sessionId)?.endedAt == null) continue;
      s.ended = true;
      this.post({ t: 'ended', stream });
    }
  }

  private async fetch(req: string, url: string) {
    let status = 500;
    let body = '';
    try {
      const res = await this.fleet.fetch(url);
      status = res.status;
      body = await res.text();
    } catch {
      /* answered as a 500 */
    }
    this.post({ t: 'fetched', req, status, body });
  }
}

// ----------------------------------------------------------------- client

export type HostStatus = 'connecting' | 'up' | 'lost';

interface ClientSink {
  open: () => void;
  event: (ev: LiveEvent) => void;
  fail: () => void;
}

interface ClientStream {
  url: string;
  sessionId: string;
  sink: ClientSink;
  /** Host the open went to (null while no host is known). */
  host: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

interface PendingFetch {
  url: string;
  /** Sent to the host (false while no host is known yet). */
  sent: boolean;
  resolve: (r: Response) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BridgeClientOptions {
  channel?: ChannelFactory;
  pingMs?: number;
  /** No host answer this long after start (or after `retry`): lost. */
  connectMs?: number;
  /** No host answer this long once it was up: lost. */
  lostMs?: number;
  /** The session this tab watches: hosts that have it are preferred. */
  sessionId?: string;
  /** Wait this long for a host that has the session before using one without it. */
  graceMs?: number;
}

/** A watch tab's side: a fake EventSource and fetch that proxy to the host. */
export class BridgeClient {
  readonly id = randomId();
  status: HostStatus = 'connecting';
  /** Current host id (changes when the lab tab reloads). */
  host: string | null = null;
  /** Sessions the host reported as finished. */
  readonly ended = new Set<string>();
  version = 0;
  readonly EventSource: typeof EventSource;

  private readonly ch: BridgeChannel;
  private readonly streams = new Map<string, ClientStream>();
  private readonly fetches = new Map<string, PendingFetch>();
  private readonly listeners = new Set<() => void>();
  private readonly pinger: ReturnType<typeof setInterval>;
  private readonly connectMs: number;
  private readonly lostMs: number;
  private startedAt = Date.now();
  private readonly sessionId: string | undefined;
  private readonly graceMs: number;
  /** The bound host has the wanted session. */
  private hostHas = false;
  /** Requests go out (false during the grace of a host without the session). */
  private ready = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Hosts that said goodbye: never bound again (a dying page can still answer). */
  private readonly gone = new Set<string>();
  private lastHostAt: number | null = null;
  private disposed = false;

  constructor(opts: BridgeClientOptions = {}) {
    this.connectMs = opts.connectMs ?? 2_000;
    this.lostMs = opts.lostMs ?? 3_000;
    this.sessionId = opts.sessionId;
    this.graceMs = opts.graceMs ?? 300;
    this.ch = (opts.channel ?? browserChannel)(LAB_CHANNEL);
    this.ch.addEventListener('message', this.onMessage);
    this.EventSource = makeBridgeEventSource(this);
    this.ping();
    this.pinger = setInterval(() => this.tick(), opts.pingMs ?? 1_000);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  /** Starts looking for the host again (the Retry button). */
  retry() {
    if (this.status === 'up') return;
    this.status = 'connecting';
    this.startedAt = Date.now();
    this.lastHostAt = null;
    this.ping();
    this.changed();
  }

  dispose() {
    if (this.disposed) return;
    this.post({ t: 'client.bye', client: this.id });
    this.disposed = true;
    clearInterval(this.pinger);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    for (const s of this.streams.values()) if (s.timer) clearTimeout(s.timer);
    this.streams.clear();
    for (const f of this.fetches.values()) {
      clearTimeout(f.timer);
      f.reject(new Error('bridge closed'));
    }
    this.fetches.clear();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    this.ch.removeEventListener('message', this.onMessage);
    this.ch.close();
    this.listeners.clear();
  }

  /** A fake `fetch` answered by the host's fleet. */
  readonly fetch = (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (this.disposed || this.status === 'lost')
      return Promise.reject(new TypeError('The lab tab is not answering'));
    const req = randomId();
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fetches.delete(req);
        reject(new TypeError('The lab tab did not answer'));
      }, this.connectMs);
      const f: PendingFetch = { url, sent: false, resolve, reject, timer };
      this.fetches.set(req, f);
      this.sendFetch(req, f);
    });
  };

  /** Opens a stream (called by the fake EventSource). Returns its closer. */
  attach(url: string, sink: ClientSink): () => void {
    if (this.disposed || this.status === 'lost') {
      sink.fail();
      return () => undefined;
    }
    const stream = randomId();
    const entry: ClientStream = {
      url,
      sessionId: sessionOf(url),
      sink,
      host: null,
      timer: setTimeout(() => this.failStream(stream), this.connectMs),
    };
    this.streams.set(stream, entry);
    this.sendOpen(stream, entry);
    return () => {
      const s = this.streams.get(stream);
      if (!s) return;
      if (s.timer) clearTimeout(s.timer);
      this.streams.delete(stream);
      if (s.host) this.post({ t: 'close', stream });
    };
  }

  /** Sends an open to the current host; without one it waits (until its timeout). */
  private sendOpen(stream: string, s: ClientStream) {
    if (!this.host || !this.ready || s.host) return;
    s.host = this.host;
    this.post({ t: 'open', host: this.host, client: this.id, stream, url: s.url });
  }

  private sendFetch(req: string, f: PendingFetch) {
    if (!this.host || !this.ready || f.sent) return;
    f.sent = true;
    this.post({ t: 'fetch', host: this.host, client: this.id, req, url: f.url });
  }

  private readonly onPageHide = () => this.post({ t: 'client.bye', client: this.id });

  private ping() {
    this.post({
      t: 'ping',
      client: this.id,
      ...(this.sessionId ? { session: this.sessionId } : {}),
    });
  }

  private flush() {
    for (const [id, s] of this.streams) this.sendOpen(id, s);
    for (const [req, f] of this.fetches) this.sendFetch(req, f);
  }

  private bind(host: string, has: boolean) {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    // Streams opened on a host without the session are failing anyway.
    if (this.host && this.host !== host)
      for (const [id, s] of [...this.streams]) if (s.host === this.host) this.failStream(id);
    this.host = host;
    this.hostHas = has;
    this.status = 'up';
    this.ready = has || !this.sessionId;
    if (this.ready) this.flush();
    else
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        this.ready = true;
        this.flush();
      }, this.graceMs);
    this.changed();
  }

  private post(m: BridgeMessage) {
    if (this.disposed) return;
    try {
      this.ch.postMessage(m);
    } catch {
      /* channel closed */
    }
  }

  private changed() {
    this.version += 1;
    for (const fn of [...this.listeners]) fn();
  }

  private tick() {
    if (this.disposed) return;
    this.ping();
    if (this.status === 'lost') return;
    const now = Date.now();
    const silent =
      this.lastHostAt == null
        ? now - this.startedAt >= this.connectMs
        : now - this.lastHostAt >= this.lostMs;
    if (silent) this.lose();
  }

  private lose() {
    this.status = 'lost';
    this.host = null;
    this.hostHas = false;
    this.ready = false;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.lastHostAt = null;
    for (const id of [...this.streams.keys()]) this.failStream(id);
    for (const [req, f] of this.fetches) {
      clearTimeout(f.timer);
      this.fetches.delete(req);
      f.reject(new TypeError('The lab tab is not answering'));
    }
    this.changed();
  }

  private failStream(id: string) {
    const s = this.streams.get(id);
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    this.streams.delete(id);
    s.sink.fail();
  }

  private readonly onMessage = (e: MessageEvent) => {
    const m = e.data as BridgeMessage;
    if (!m || typeof m !== 'object' || this.disposed) return;
    switch (m.t) {
      case 'host': {
        if (this.gone.has(m.host)) return;
        const has = m.has === true;
        if (this.host && m.host !== this.host) {
          // Sticky, unless this other lab tab has our session and ours does not.
          if (!has || this.hostHas) return;
          this.lastHostAt = Date.now();
          this.bind(m.host, true);
          return;
        }
        this.lastHostAt = Date.now();
        if (m.host === this.host && this.status === 'up') {
          if (has && !this.hostHas) this.bind(m.host, true);
          return;
        }
        this.bind(m.host, has);
        break;
      }
      case 'bye':
        this.gone.add(m.host);
        if (m.host === this.host) this.lose();
        break;
      case 'opened': {
        const s = this.streams.get(m.stream);
        if (!s || s.host !== m.host || this.gone.has(m.host)) return;
        if (s.timer) clearTimeout(s.timer);
        s.timer = null;
        if (m.ended && !this.ended.has(s.sessionId)) {
          this.ended.add(s.sessionId);
          this.changed();
        }
        s.sink.open();
        break;
      }
      case 'event':
        this.streams.get(m.stream)?.sink.event(m.ev);
        break;
      case 'fail':
        this.failStream(m.stream);
        break;
      case 'ended': {
        const s = this.streams.get(m.stream);
        if (!s || this.ended.has(s.sessionId)) return;
        this.ended.add(s.sessionId);
        this.changed();
        break;
      }
      case 'fetched': {
        const f = this.fetches.get(m.req);
        if (!f) return;
        clearTimeout(f.timer);
        this.fetches.delete(m.req);
        f.resolve(
          new Response(m.body, {
            status: m.status,
            headers: { 'content-type': 'application/json' },
          }),
        );
        break;
      }
      default:
        break;
    }
  };
}

type Listener = (ev: Event) => void;

/** An `EventSource` class whose connections go through the bridge client. */
function makeBridgeEventSource(client: BridgeClient): typeof EventSource {
  class BridgeEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readonly url: string;
    readonly withCredentials: boolean;
    readyState = 0;
    onopen: Listener | null = null;
    onmessage: Listener | null = null;
    onerror: Listener | null = null;
    private listeners = new Map<string, Set<Listener>>();
    private detach: (() => void) | null = null;

    constructor(url: string | URL, init?: EventSourceInit) {
      this.url = String(url);
      this.withCredentials = !!init?.withCredentials;
      // Listeners are added right after construction: connect on the next tick.
      queueMicrotask(() => {
        if (this.readyState === 2) return;
        this.detach = client.attach(this.url, {
          open: () => {
            if (this.readyState === 2) return;
            this.readyState = 1;
            this.emit('open', new Event('open'));
          },
          event: (ev) => {
            if (this.readyState === 2) return;
            this.emit(
              ev.type,
              new MessageEvent(ev.type, { data: JSON.stringify(ev), lastEventId: String(ev.id) }),
            );
          },
          fail: () => {
            if (this.readyState === 2) return;
            this.readyState = 2;
            this.detach = null;
            this.emit('error', new Event('error'));
          },
        });
      });
    }

    private emit(type: string, ev: Event) {
      if (type === 'open') this.onopen?.(ev);
      if (type === 'error') this.onerror?.(ev);
      for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
    }

    addEventListener(type: string, fn: EventListenerOrEventListenerObject | null) {
      if (!fn) return;
      const f: Listener = typeof fn === 'function' ? fn : (e) => fn.handleEvent(e);
      let set = this.listeners.get(type);
      if (!set) this.listeners.set(type, (set = new Set()));
      set.add(f);
    }

    removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null) {
      if (typeof fn === 'function') this.listeners.get(type)?.delete(fn);
    }

    dispatchEvent(ev: Event): boolean {
      this.emit(ev.type, ev);
      return true;
    }

    close() {
      this.readyState = 2;
      this.detach?.();
      this.detach = null;
    }
  }
  return BridgeEventSource as unknown as typeof EventSource;
}

/** A `loadPage` for `LiveSessionFeed` over any fake `fetch` (fleet or bridge). */
export function loadPageVia(fetchImpl: typeof fetch) {
  return async (
    id: string,
    params: { after?: number; until?: number; limit?: number } = {},
  ): Promise<SessionEventsPage> => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
    const res = await fetchImpl(`/api/v1/sessions/${encodeURIComponent(id)}/events?${q}`);
    if (!res.ok) throw new Error(`${res.status} not found`);
    return (await res.json()) as SessionEventsPage;
  };
}

/** Path of the dedicated watch page of one session (dev-only, like the lab). */
export const watchPath = (sessionId: string) =>
  `/lab/live-agents/watch/${encodeURIComponent(sessionId)}`;
