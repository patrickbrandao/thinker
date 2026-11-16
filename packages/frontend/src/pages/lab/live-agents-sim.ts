/**
 * Lab only: an in-browser fake backend for the Live agents wall.
 *
 * A fleet of simulated harnesses keeps starting sessions. Each session plays
 * one of the live-session lab scenarios (`live-session-sim.ts`) through its
 * `SimServer`, with failures injected on demand, and is re-emitted here in the
 * shared wire format (`thinker-shared` `LiveEvent`). The fleet exposes:
 *
 * - `fetch`: answers `GET /api/v1/sessions?running=true`, `GET /api/v1/agents`,
 *   `GET /api/v1/sessions/:id/events` (replay history) and the live URL probe
 *   the feed client sends after a permanent EventSource failure;
 * - `EventSource`: a class for `/api/v1/sessions/:id/live` that sends a
 *   snapshot first (or replays after `lastEventId`) and then the live events.
 *
 * Both are injected into the official `LiveSessionFeed`, so the window
 * components run unmodified, and nothing touches the real API.
 */
import {
  reduceLiveEvents,
  type LiveEvent,
  type LiveEventType,
  type LiveSessionMeta,
  type LiveWireFormat,
} from 'thinker-shared';
import type { SessionEventsPage, SessionSummary } from '../../services/api/sessions.js';
import { SCENARIOS, SimServer, type Protocol, type Scenario } from './live-session-sim.js';

// ---------------------------------------------------------------- config

export interface FleetConfig {
  /** Simulated harnesses, each running one session at a time (1–40). */
  agents: number;
  /** Idle gap between two sessions of one agent, seconds (jittered ±50%). */
  startIntervalSec: number;
  /** Requests per session; 0 plays the scenario as written. */
  turns: number;
  /** Playback speed of the streams and of the idle gaps. */
  speed: number;
  /** % of requests whose first attempt gets a 429 and falls back. */
  fallbackPct: number;
  /** % of requests whose first attempt is cut mid-stream and falls back. */
  cutPct: number;
  /** A finished session stays in the running set this long (the API uses 5 min). */
  runningWindowSec: number;
}

export const DEFAULT_FLEET: FleetConfig = {
  agents: 6,
  startIntervalSec: 8,
  turns: 0,
  speed: 1,
  fallbackPct: 10,
  cutPct: 5,
  runningWindowSec: 15,
};

/** The backend's live feed limit per organization (LIVE_MAX_CONNECTIONS_PER_TENANT). */
export const FAKE_MAX_LIVE_CONNECTIONS = 20;
/** Ended sessions kept for history (older ones are forgotten). */
const MAX_ENDED = 200;

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export function cleanFleetConfig(raw: Partial<FleetConfig> | undefined): FleetConfig {
  const c = { ...DEFAULT_FLEET, ...(raw ?? {}) };
  return {
    agents: Math.round(clamp(c.agents, 1, 40)),
    startIntervalSec: clamp(c.startIntervalSec, 0, 600),
    turns: Math.round(clamp(c.turns, 0, 50)),
    speed: clamp(c.speed, 0.1, 20),
    fallbackPct: clamp(c.fallbackPct, 0, 100),
    cutPct: clamp(c.cutPct, 0, 100),
    runningWindowSec: clamp(c.runningWindowSec, 0, 600),
  };
}

// ------------------------------------------------------------- scenarios

const WIRE: Record<Protocol, LiveWireFormat> = {
  'anthropic-messages': 'anthropic_messages',
  'openai-responses': 'openai_responses',
  'openai-chat': 'openai_chat_completions',
};

const PLATFORM: Record<string, string> = {
  'claude-code': 'claude-code',
  codex: 'codex',
  hermes: 'hermes',
  openclaw: 'openclaw',
};

const MODELS: Record<string, string[]> = {
  'claude-code': ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'thinker/auto'],
  codex: ['gpt-5.5-codex', 'gpt-5.5', 'thinker/auto'],
  hermes: ['deepseek-v4', 'kimi-k2.6', 'glm-5', 'qwen3.6-coder'],
  openclaw: ['thinker/writer', 'gpt-5.5-mini', 'glm-5'],
};

const NAMES = [
  'macbook',
  'devbox',
  'ops',
  'home',
  'ci',
  'studio',
  'lab',
  'nightly',
  'review',
  'triage',
  'docs',
  'infra',
  'mobile',
  'billing',
  'search',
  'edge',
];

const FALLBACK_PROVIDER = 'OpenRouter (API key)';

type Steps = Scenario['steps'];
type RequestStep = Extract<Steps[number], { kind: 'request' }>;
type Attempt = RequestStep['attempts'][number];

const pick = <T>(list: readonly T[], rand: () => number): T =>
  list[Math.floor(rand() * list.length) % list.length]!;

function renameTools(step: Steps[number], cycle: number): Steps[number] {
  if (cycle === 0) return step;
  const sfx = `_r${cycle + 1}`;
  if (step.kind === 'tool_result') return { ...step, toolCallId: step.toolCallId + sfx };
  if (step.kind !== 'request') return step;
  return {
    ...step,
    attempts: step.attempts.map((a) => ({
      ...a,
      blocks: a.blocks?.map((b) => (b.toolCallId ? { ...b, toolCallId: b.toolCallId + sfx } : b)),
    })),
  };
}

/** The scenario's steps cut or looped to `turns` requests (0 keeps them as written). */
export function fitTurns(steps: Steps, turns: number): Steps {
  if (turns <= 0) return steps;
  const firstUser = steps.findIndex((s) => s.kind === 'user');
  const head = steps.slice(0, firstUser + 1);
  const body = steps.slice(firstUser + 1);
  if (!body.some((s) => s.kind === 'request')) return steps;
  const out: Steps = [...head];
  let n = 0;
  for (let cycle = 0; n < turns; cycle++) {
    if (cycle > 0)
      out.push({ kind: 'user', delayMs: 900, text: `Keep going (round ${cycle + 1}).` });
    for (const step of body) {
      if (step.kind === 'request') {
        if (n >= turns) break;
        n += 1;
      }
      out.push(renameTools(step, cycle));
    }
  }
  // Nothing after the last request: the session ends on an answer.
  while (out.length && out.at(-1)!.kind !== 'request') out.pop();
  return out;
}

/** Prepends a failing attempt (429, or a mid-stream cut) to some requests. */
function injectFailures(steps: Steps, cfg: FleetConfig, rand: () => number): Steps {
  return steps.map((step) => {
    if (step.kind !== 'request') return step;
    const first = step.attempts[0];
    // Requests that already fail or get cancelled keep their own script.
    if (!first || first.fail || first.cancel) return step;
    const r = rand() * 100;
    const fallback: Attempt = {
      ...first,
      provider: FALLBACK_PROVIDER,
      route: 'fallback',
      upstream: 'openai-chat',
      endpoint: undefined,
    };
    if (r < cfg.fallbackPct) {
      const failed: Attempt = {
        ...first,
        blocks: [],
        fail: {
          status: 429,
          message: 'rate_limit_error: too many requests, retry after 20s',
          afterMs: 450,
        },
      };
      return { ...step, attempts: [failed, fallback, ...step.attempts.slice(1)] };
    }
    if (r < cfg.fallbackPct + cfg.cutPct && first.blocks?.length) {
      const failed: Attempt = {
        ...first,
        fail: {
          status: 502,
          message: 'upstream connection reset mid-stream',
          afterMs: 0,
          cut: { block: Math.floor(rand() * first.blocks.length), fraction: 0.4 + rand() * 0.4 },
        },
      };
      return { ...step, attempts: [failed, fallback, ...step.attempts.slice(1)] };
    }
    return step;
  });
}

// ------------------------------------------------------------------ fleet

interface FleetAgent {
  name: string;
  scenarioId: string;
  platform: string;
  model: string;
  timer: ReturnType<typeof setTimeout> | null;
  session: SimSession | null;
  removed: boolean;
}

interface SimSession {
  id: string;
  agent: FleetAgent;
  server: SimServer;
  meta: LiveSessionMeta & { title: string };
  log: LiveEvent[];
  nextId: number;
  startedAt: number;
  lastAt: number;
  endedAt: number | null;
  inFlight: Set<string>;
  requests: number;
  failed: number;
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
  models: Set<string>;
  providers: Set<string>;
  streams: Set<FakeStream>;
  unsubscribe: () => void;
}

interface FakeStream {
  deliver: (ev: LiveEvent) => void;
  fail: () => void;
}

export interface FleetStats {
  agents: number;
  /** Sessions in the running set (what the wall sees). */
  running: number;
  /** Sessions still playing. */
  active: number;
  /** Sessions that finished since the last reset. */
  ended: number;
  /** Open fake EventSource connections. */
  liveConnections: number;
}

export interface FleetOptions {
  random?: () => number;
  /** false: the agents wait for `start()` (tests). Default true. */
  autoStart?: boolean;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const hex = (rand: () => number, n: number) =>
  Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');

export class Fleet {
  config: FleetConfig;
  paused = false;
  readonly agents: FleetAgent[] = [];
  readonly sessions = new Map<string, SimSession>();
  private ended = 0;
  private names = 0;
  private started = false;
  private connections = 0;
  private watchers = new Set<() => void>();
  private readonly rand: () => number;
  /** A fake `EventSource` bound to this fleet (inject into `LiveSessionFeed`). */
  readonly EventSource: typeof EventSource;

  constructor(config: Partial<FleetConfig> = {}, opts: FleetOptions = {}) {
    this.config = cleanFleetConfig(config);
    this.rand = opts.random ?? Math.random;
    this.EventSource = makeEventSource(this);
    if (opts.autoStart !== false) this.start();
  }

  // ------------------------------------------------------------ control

  watch(fn: () => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  private changed() {
    for (const w of this.watchers) w();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.syncAgents();
  }

  configure(patch: Partial<FleetConfig>) {
    this.config = cleanFleetConfig({ ...this.config, ...patch });
    for (const s of this.sessions.values()) s.server.speed = this.config.speed;
    if (this.started) this.syncAgents();
    this.changed();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    for (const a of this.agents) this.clearTimer(a);
    for (const s of this.sessions.values()) if (s.endedAt == null) s.server.pause();
    this.changed();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    for (const s of this.sessions.values()) if (s.endedAt == null) s.server.play();
    for (const a of this.agents) if (!a.session) this.scheduleStart(a, true);
    this.changed();
  }

  /** Drops every session and agent and starts over (a new fleet). */
  reset() {
    for (const a of this.agents) this.clearTimer(a);
    this.agents.length = 0;
    for (const s of this.sessions.values()) this.forget(s);
    this.sessions.clear();
    this.ended = 0;
    this.names = 0;
    if (this.started) this.syncAgents();
    this.changed();
  }

  dispose() {
    this.started = false;
    this.reset();
    this.watchers.clear();
  }

  stats(now = Date.now()): FleetStats {
    let active = 0;
    for (const s of this.sessions.values()) if (s.endedAt == null) active += 1;
    return {
      agents: this.agents.length,
      running: this.running(now).length,
      active,
      ended: this.ended,
      liveConnections: this.connections,
    };
  }

  /** Sessions in the running set: playing, or finished within the running window. */
  running(now = Date.now()): SimSession[] {
    const windowMs = this.config.runningWindowSec * 1000;
    return [...this.sessions.values()]
      .filter((s) => s.endedAt == null || now - s.lastAt < windowMs)
      .sort((a, b) => b.lastAt - a.lastAt);
  }

  // ------------------------------------------------------------- agents

  private syncAgents() {
    const want = this.config.agents;
    while (this.agents.length < want) {
      const agent = this.newAgent();
      this.agents.push(agent);
      // The first agents start right away; the others spread over the interval.
      this.scheduleStart(agent, this.agents.length > 1);
    }
    while (this.agents.length > want) {
      const agent = this.agents.pop()!;
      agent.removed = true;
      this.clearTimer(agent);
    }
  }

  private newAgent(): FleetAgent {
    const scenario = SCENARIOS[this.names % SCENARIOS.length]!;
    const base = scenario.session.agent.split('-').slice(0, -1).join('-') || scenario.id;
    const n = this.names++;
    const word = NAMES[n % NAMES.length]!;
    const round = Math.floor(n / NAMES.length);
    return {
      name: `${base}-${word}${round ? `-${round + 1}` : ''}`,
      scenarioId: scenario.id,
      platform: PLATFORM[scenario.id] ?? 'other',
      model: pick(MODELS[scenario.id] ?? [scenario.session.requestedModel], this.rand),
      timer: null,
      session: null,
      removed: false,
    };
  }

  private clearTimer(a: FleetAgent) {
    if (a.timer) clearTimeout(a.timer);
    a.timer = null;
  }

  private scheduleStart(agent: FleetAgent, jitter: boolean) {
    this.clearTimer(agent);
    if (this.paused || agent.removed) return;
    const base = (this.config.startIntervalSec * 1000) / this.config.speed;
    const delay = jitter ? base * (0.5 + this.rand()) : 0;
    agent.timer = setTimeout(() => {
      agent.timer = null;
      this.startSession(agent);
    }, delay);
  }

  /** Starts one session for the agent now (also used by tests). */
  startSession(agent: FleetAgent = this.agents[0]!): SimSession {
    const base = SCENARIOS.find((s) => s.id === agent.scenarioId) ?? SCENARIOS[0]!;
    const id = `ses_${hex(this.rand, 8)}`;
    const fitted = fitTurns(JSON.parse(JSON.stringify(base.steps)) as Steps, this.config.turns);
    // The agent's model on the first attempt of every request (fallbacks keep theirs).
    const withModel = fitted.map((step) =>
      step.kind === 'request' && step.attempts[0]
        ? {
            ...step,
            attempts: step.attempts.map((a, i) => (i === 0 ? { ...a, model: agent.model } : a)),
          }
        : step,
    );
    const steps = injectFailures(withModel, this.config, this.rand);
    const title =
      steps.find((s): s is Extract<Steps[number], { kind: 'user' }> => s.kind === 'user')?.text ??
      base.session.title;
    const scenario: Scenario = {
      ...base,
      session: {
        ...base.session,
        sessionId: id,
        title,
        agent: agent.name,
        requestedModel: agent.model,
      },
      steps,
    };
    const server = new SimServer(scenario);
    server.speed = this.config.speed;
    const now = Date.now();
    const s: SimSession = {
      id,
      agent,
      server,
      meta: {
        sessionId: id,
        agentName: agent.name,
        harness: base.session.harness,
        title: title.length > 80 ? `${title.slice(0, 79)}…` : title,
      },
      log: [],
      nextId: 0,
      startedAt: now,
      lastAt: now,
      endedAt: null,
      inFlight: new Set(),
      requests: 0,
      failed: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cost: 0,
      models: new Set(),
      providers: new Set(),
      streams: new Set(),
      unsubscribe: () => undefined,
    };
    // A join with lastEventId 0 replays nothing: we get every event live.
    const off = server.connect((ev) => {
      if (ev.type === 'heartbeat') return;
      this.record(s, ev.type as LiveEventType, ev.ts, ev.data);
    }, 0);
    const unwatch = server.watch(() => {
      if (server.finished && s.endedAt == null) this.finish(s);
    });
    s.unsubscribe = () => {
      off();
      unwatch();
    };
    agent.session = s;
    this.sessions.set(id, s);
    if (!this.paused) server.play();
    this.changed();
    return s;
  }

  private record(s: SimSession, type: LiveEventType, ts: number, raw: Record<string, unknown>) {
    const data: Record<string, unknown> = { ...raw };
    if (type === 'request.started') {
      data.upstream = WIRE[raw.upstream as Protocol] ?? null;
      s.inFlight.add(String(raw.attemptId));
      if (raw.attempt === 1) s.requests += 1;
      s.models.add(String(raw.model));
      s.providers.add(String(raw.provider));
    } else if (type === 'request.completed') {
      const u = (raw.usage ?? {}) as Record<string, number | undefined>;
      data.usage = {
        input: u.input ?? 0,
        output: u.output ?? 0,
        cacheRead: u.cacheRead ?? 0,
        cacheWrite: 0,
        reasoning: u.reasoning ?? 0,
      };
      s.inFlight.delete(String(raw.attemptId));
      s.input += u.input ?? 0;
      s.output += u.output ?? 0;
      s.cacheRead += u.cacheRead ?? 0;
      s.cost += typeof raw.costUsd === 'number' ? raw.costUsd : 0;
    } else if (type === 'request.failed' || type === 'request.cancelled') {
      s.inFlight.delete(String(raw.attemptId));
      if (type === 'request.failed' && raw.next !== 'fallback') s.failed += 1;
    }
    const ev: LiveEvent = { id: ++s.nextId, type, ts, data };
    s.log.push(ev);
    s.lastAt = ts;
    for (const st of s.streams) st.deliver(ev);
  }

  private finish(s: SimSession) {
    s.endedAt = Date.now();
    s.inFlight.clear();
    this.ended += 1;
    const agent = s.agent;
    if (agent.session === s) agent.session = null;
    this.scheduleStart(agent, true);
    this.prune();
    this.changed();
  }

  private prune() {
    const ended = [...this.sessions.values()]
      .filter((s) => s.endedAt != null)
      .sort((a, b) => a.lastAt - b.lastAt);
    for (const s of ended.slice(0, Math.max(0, ended.length - MAX_ENDED))) {
      this.forget(s);
      this.sessions.delete(s.id);
    }
  }

  private forget(s: SimSession) {
    s.unsubscribe();
    s.server.dispose();
    for (const st of [...s.streams]) st.fail();
    s.streams.clear();
  }

  // ------------------------------------------------------------ backend

  private summary(s: SimSession): SessionSummary {
    return {
      id: s.id,
      agent_id: null,
      agent_name: s.agent.name,
      started_at: new Date(s.startedAt).toISOString(),
      last_at: new Date(s.lastAt).toISOString(),
      requests: s.requests,
      failed: s.failed,
      in_flight: s.inFlight.size,
      subagents: 0,
      input_tokens: s.input,
      output_tokens: s.output,
      cache_read_tokens: s.cacheRead,
      cache_creation_tokens: 0,
      cost: s.cost,
      models: [...s.models],
      providers: [...s.providers],
    };
  }

  private agentList() {
    const seen = new Map<string, FleetAgent>();
    for (const a of this.agents) seen.set(a.name, a);
    for (const s of this.sessions.values())
      if (!seen.has(s.agent.name)) seen.set(s.agent.name, s.agent);
    return [...seen.values()].map((a) => ({
      agent_name: a.name,
      display_name: a.name,
      agent_platform: a.platform,
      agent_category: 'coding',
    }));
  }

  /** History page, as `GET /sessions/:id/events` returns it. */
  eventsPage(
    id: string,
    p: { after?: number; until?: number; limit?: number },
  ): SessionEventsPage | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    const after = p.after ?? 0;
    const until = p.until ?? Infinity;
    const limit = Math.max(1, Math.min(1000, p.limit ?? 1000));
    const all = s.log.filter((e) => e.id > after && e.id <= until);
    const events = all.slice(0, limit);
    return {
      session: s.meta,
      events,
      next_after: all.length > limit ? events.at(-1)!.id : null,
    };
  }

  /** A fake `fetch` for the endpoints the wall and the feed client call. */
  readonly fetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://lab.invalid');
    const path = url.pathname.replace(/\/+$/, '');
    const q = url.searchParams;
    if (path === '/api/v1/sessions') {
      const now = Date.now();
      let list =
        q.get('running') === 'true'
          ? this.running(now)
          : [...this.sessions.values()].sort((a, b) => b.lastAt - a.lastAt);
      const agent = q.get('agent_name');
      if (agent) list = list.filter((s) => s.agent.name === agent);
      const limit = Number(q.get('limit') ?? 100) || 100;
      return json({
        items: list.slice(0, limit).map((s) => this.summary(s)),
        has_more: list.length > limit,
      });
    }
    if (path === '/api/v1/agents') return json({ agents: this.agentList() });
    const m = /^\/api\/v1\/sessions\/([^/]+)\/(events|live)$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      if (m[2] === 'events') {
        const num = (k: string) => (q.get(k) != null ? Number(q.get(k)) : undefined);
        const page = this.eventsPage(id, {
          after: num('after'),
          until: num('until'),
          limit: num('limit'),
        });
        return page ? json(page) : json({ message: 'Session not found' }, 404);
      }
      if (!this.sessions.has(id)) return json({ message: 'Session not found' }, 404);
      if (this.connections >= FAKE_MAX_LIVE_CONNECTIONS)
        return json({ message: 'Too many live connections' }, 429);
      return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return json({ message: `Not simulated: ${path}` }, 404);
  };

  // ----------------------------------------------------- live connections

  /** Wires one fake EventSource to its session (called by the fake class). */
  attach(url: string, sink: FakeSink): () => void {
    const u = new URL(url, 'http://lab.invalid');
    const m = /^\/api\/v1\/sessions\/([^/]+)\/live$/.exec(u.pathname);
    const s = m ? this.sessions.get(decodeURIComponent(m[1]!)) : undefined;
    if (!s || this.connections >= FAKE_MAX_LIVE_CONNECTIONS) {
      sink.fail();
      return () => undefined;
    }
    this.connections += 1;
    const lastParam = u.searchParams.get('lastEventId');
    const lastEventId = lastParam != null ? Number(lastParam) : null;
    const stream: FakeStream = {
      deliver: (ev) => sink.event(ev),
      fail: () => {
        detach();
        sink.fail();
      },
    };
    let attached = true;
    const detach = () => {
      if (!attached) return;
      attached = false;
      s.streams.delete(stream);
      this.connections -= 1;
      this.changed();
    };
    sink.open();
    if (lastEventId != null && Number.isFinite(lastEventId) && lastEventId > 0) {
      for (const ev of s.log) if (ev.id > lastEventId) sink.event(ev);
    } else {
      sink.event({
        id: s.log.at(-1)?.id ?? 0,
        type: 'snapshot',
        ts: Date.now(),
        data: { session: s.meta, state: reduceLiveEvents(s.log) },
      });
    }
    s.streams.add(stream);
    this.changed();
    return detach;
  }
}

interface FakeSink {
  open: () => void;
  event: (ev: LiveEvent) => void;
  fail: () => void;
}

type Listener = (ev: Event) => void;

function makeEventSource(fleet: Fleet): typeof EventSource {
  class FakeEventSource {
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
        this.detach = fleet.attach(this.url, {
          open: () => {
            this.readyState = 1;
            this.emit('open', new Event('open'));
          },
          event: (ev) =>
            this.emit(
              ev.type,
              new MessageEvent(ev.type, { data: JSON.stringify(ev), lastEventId: String(ev.id) }),
            ),
          fail: () => {
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
  return FakeEventSource as unknown as typeof EventSource;
}

/** A `loadPage` for `LiveSessionFeed` that reads history from the fleet. */
export function fleetLoadPage(fleet: Fleet) {
  return async (
    id: string,
    params: { after?: number; until?: number; limit?: number } = {},
  ): Promise<SessionEventsPage> => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
    const res = await fleet.fetch(`/api/v1/sessions/${encodeURIComponent(id)}/events?${q}`);
    if (!res.ok) throw new Error(`${res.status} not found`);
    return (await res.json()) as SessionEventsPage;
  };
}
