import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  applyLiveEvent,
  emptyLiveState,
  type LiveAttempt,
  type LiveEvent,
  type LiveEventType,
  type LiveSessionMeta,
  type LiveState,
} from 'thinker-shared';
import { detectHarnessSession } from '../routing/proxy/harness-session';
import type { ProxyApiMode } from '../routing/proxy/proxy-types';
import { ConversationTracker } from './live-conversation';
import { LiveRequestCapture } from './live-request-capture';
import {
  accessKey,
  eventForViewer,
  fillTitle,
  harnessName,
  sseFrame,
  type LiveAccessKey,
  type LiveViewerAccess,
} from './live-wire';

/** Limits of the in-memory hub (docs/dev/janela-sessao-ao-vivo.md, "Hub"). */
export const LIVE_BUFFER_MAX_EVENTS = 5000;
export const LIVE_BUFFER_MAX_BYTES = 4 * 1024 * 1024;
export const LIVE_IDLE_TTL_MS = 10 * 60 * 1000;
export const LIVE_MAX_CONNECTIONS_PER_TENANT = 20;
export const LIVE_MAX_ENTRIES = 1000;
export const LIVE_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/** Attempts whose headers/body stay in the snapshot state (older ones drop them). */
const STATE_BODIES_KEPT = 10;
/** Items kept in the snapshot state; older ones fall out first. */
const STATE_MAX_ITEMS = 3000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const CUSTOM_NAMES_TTL_MS = 60 * 1000;

export interface StoredLiveEvent {
  event: LiveEvent;
  size: number;
  json: Partial<Record<LiveAccessKey, string>>;
}

export interface LiveSubscriber {
  access: LiveViewerAccess;
  /** Writes one SSE chunk; the subscriber closes itself when it falls behind. */
  send(chunk: string): void;
  close(): void;
}

export class LiveSessionEntry {
  readonly createdAtMs = Date.now();
  lastActivityMs = Date.now();
  /**
   * Ids start at the entry's creation time (ms) so an id from an earlier
   * lifetime of the same session (restart, eviction) never lands inside
   * this buffer: such a client gets a snapshot instead of a wrong replay.
   */
  nextId = Date.now();
  readonly events: StoredLiveEvent[] = [];
  bytes = 0;
  /** True once the buffer dropped its oldest events. */
  dropped = false;
  readonly state: LiveState = emptyLiveState();
  readonly subscribers = new Set<LiveSubscriber>();
  readonly conversation = new ConversationTracker();
  /** Requests this entry saw, so a DB seed does not repeat them. */
  readonly requestIds = new Set<string>();
  /** The entry emitted a conversation.reset (its messages are complete). */
  hadReset = false;
  /** Requests whose attempts are still on the wire. */
  inFlight = 0;

  constructor(
    readonly key: string,
    readonly tenantId: string,
    readonly sessionId: string,
    public meta: LiveSessionMeta,
  ) {
    this.state.lastEventId = this.nextId - 1;
  }

  get lastId(): number {
    return this.nextId - 1;
  }

  get firstBufferedId(): number {
    return this.events[0]?.event.id ?? this.nextId;
  }
}

/** The tenant + session key: two organizations never share an entry. */
export function liveKey(tenantId: string, sessionId: string): string {
  return `${tenantId}\u0000${sessionId}`;
}

export interface OpenLiveRequest {
  tenantId: string;
  agentName: string | null;
  headers: Record<string, string | string[] | undefined>;
  requestId: string;
  apiMode: ProxyApiMode;
  body: Record<string, unknown>;
  /** Attempt recording is on for the harness (gates headers/body). */
  recording: boolean;
}

@Injectable()
export class LiveSessionHubService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveSessionHubService.name);
  private readonly entries = new Map<string, LiveSessionEntry>();
  private readonly connections = new Map<string, number>();
  private readonly customNames = new Map<string, { at: number; names: Map<string, string> }>();
  private totalBytes = 0;
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(@Optional() @InjectDataSource() private readonly ds?: DataSource) {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
    for (const entry of this.entries.values()) {
      for (const sub of entry.subscribers) sub.close();
    }
    this.entries.clear();
  }

  // ------------------------------------------------------------ proxy side

  /**
   * Starts the live capture of one harness request, or returns null when the
   * request names no session. Never throws: a failure only disables the
   * capture for this request.
   */
  openRequest(input: OpenLiveRequest): LiveRequestCapture | null {
    try {
      const session = detectHarnessSession(input.headers);
      if (!session) return null;
      const entry = this.entryFor(input.tenantId, session.id, {
        sessionId: session.id,
        agentName: input.agentName,
        harness: harnessName(input.headers),
      });
      if (!entry.meta.harness) entry.meta.harness = harnessName(input.headers);
      entry.requestIds.add(input.requestId);
      entry.lastActivityMs = Date.now();
      this.refreshCustomNames(input.tenantId);
      const capture = new LiveRequestCapture(this, entry, input, this.logger);
      capture.recordConversation(input.body, input.apiMode);
      return capture;
    } catch (error) {
      this.logger.warn(
        `Live session capture disabled for request ${input.requestId}: ${String(error)}`,
      );
      return null;
    }
  }

  /** Custom provider display names of a tenant (refreshed in the background). */
  customProviderNames(tenantId: string): ReadonlyMap<string, string> | undefined {
    return this.customNames.get(tenantId)?.names;
  }

  private refreshCustomNames(tenantId: string): void {
    const cached = this.customNames.get(tenantId);
    if (!this.ds || (cached && Date.now() - cached.at < CUSTOM_NAMES_TTL_MS)) return;
    // Mark first so concurrent requests do not stampede the query.
    this.customNames.set(tenantId, { at: Date.now(), names: cached?.names ?? new Map() });
    this.ds
      .query('SELECT id, name FROM custom_providers WHERE tenant_id = $1', [tenantId])
      .then((rows: Array<{ id: string; name: string }>) => {
        this.customNames.set(tenantId, {
          at: Date.now(),
          names: new Map(rows.map((r) => [String(r.id), String(r.name)])),
        });
      })
      .catch((e: unknown) => this.logger.warn(`Live session provider names: ${String(e)}`));
  }

  /** Appends one event to the session: id, buffer, state, subscribers. */
  emit(entry: LiveSessionEntry, type: LiveEventType, data: Record<string, unknown>): LiveEvent {
    const event: LiveEvent = { id: entry.nextId++, type, ts: Date.now(), data };
    const full = JSON.stringify(event);
    const stored: StoredLiveEvent = { event, size: full.length, json: { full } };
    entry.events.push(stored);
    entry.bytes += stored.size;
    this.totalBytes += stored.size;
    entry.lastActivityMs = event.ts;
    while (
      entry.events.length > 1 &&
      (entry.events.length > LIVE_BUFFER_MAX_EVENTS || entry.bytes > LIVE_BUFFER_MAX_BYTES)
    ) {
      const old = entry.events.shift()!;
      entry.bytes -= old.size;
      this.totalBytes -= old.size;
      entry.dropped = true;
    }
    if (type === 'conversation.reset') entry.hadReset = true;
    if (type === 'conversation.reset' && Array.isArray(data.messages)) {
      fillTitle(entry.meta, data.messages as Array<{ role: string; text: string }>);
    } else if (type === 'message.appended') {
      fillTitle(entry.meta, [data as { role: string; text: string }]);
    }
    applyLiveEvent(entry.state, event);
    if (type === 'request.started' || entry.state.items.length > STATE_MAX_ITEMS) {
      trimState(entry.state);
    }
    for (const sub of entry.subscribers) {
      try {
        sub.send(this.frame(stored, sub.access));
      } catch {
        sub.close();
      }
    }
    if (this.totalBytes > LIVE_MAX_TOTAL_BYTES) this.evict();
    return event;
  }

  /** The SSE frame of a stored event for a viewer's access. */
  frame(stored: StoredLiveEvent, access: LiveViewerAccess): string {
    const key = accessKey(access);
    let json = stored.json[key];
    if (json === undefined) {
      json = JSON.stringify(eventForViewer(stored.event, access));
      stored.json[key] = json;
    }
    return sseFrame(stored.event, json);
  }

  // --------------------------------------------------------- consumer side

  find(tenantId: string, sessionId: string): LiveSessionEntry | undefined {
    return this.entries.get(liveKey(tenantId, sessionId));
  }

  /** The session's entry, created (empty) when it has none. */
  entryFor(tenantId: string, sessionId: string, meta: LiveSessionMeta): LiveSessionEntry {
    const key = liveKey(tenantId, sessionId);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= LIVE_MAX_ENTRIES) this.evict(true);
      entry = new LiveSessionEntry(key, tenantId, sessionId, meta);
      this.entries.set(key, entry);
    }
    return entry;
  }

  /**
   * Buffered events after `lastEventId`, or null when that id is not
   * covered by the buffer (the client needs a snapshot).
   */
  eventsAfter(entry: LiveSessionEntry, lastEventId: number | null): StoredLiveEvent[] | null {
    if (lastEventId === null || !Number.isFinite(lastEventId)) return null;
    if (lastEventId > entry.lastId || lastEventId < entry.firstBufferedId - 1) return null;
    return entry.events.filter((e) => e.event.id > lastEventId);
  }

  /**
   * The reducer state at the entry's last id, for a viewer. `seed` holds
   * what happened before the entry existed (synthesized from the database).
   */
  snapshotState(
    entry: LiveSessionEntry,
    access: LiveViewerAccess,
    seed?: LiveState | null,
  ): LiveState {
    const state = JSON.parse(JSON.stringify(entry.state)) as LiveState;
    if (seed && seed.items.length > 0) {
      const seedItems = entry.hadReset
        ? seed.items.filter((i) => i.kind === 'attempt')
        : seed.items;
      state.items = [
        ...(JSON.parse(JSON.stringify(seedItems)) as LiveState['items']),
        ...state.items,
      ];
      state.totals = {
        requests: state.totals.requests + seed.totals.requests,
        input: state.totals.input + seed.totals.input,
        output: state.totals.output + seed.totals.output,
        costUsd: state.totals.costUsd + seed.totals.costUsd,
      };
      trimState(state);
    }
    stripStateForViewer(state, access);
    state.lastEventId = entry.lastId;
    return state;
  }

  subscribe(entry: LiveSessionEntry, sub: LiveSubscriber): () => void {
    entry.subscribers.add(sub);
    entry.lastActivityMs = Date.now();
    return () => {
      entry.subscribers.delete(sub);
      entry.lastActivityMs = Date.now();
    };
  }

  /** Reserves one live connection for the tenant; false past the limit. */
  acquireConnection(tenantId: string): boolean {
    const n = this.connections.get(tenantId) ?? 0;
    if (n >= LIVE_MAX_CONNECTIONS_PER_TENANT) return false;
    this.connections.set(tenantId, n + 1);
    return true;
  }

  releaseConnection(tenantId: string): void {
    const n = (this.connections.get(tenantId) ?? 1) - 1;
    if (n <= 0) this.connections.delete(tenantId);
    else this.connections.set(tenantId, n);
  }

  // ------------------------------------------------------------ eviction

  /** Drops idle entries nobody watches (10 minutes after the last activity). */
  sweep(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (
        entry.subscribers.size === 0 &&
        entry.inFlight === 0 &&
        now - entry.lastActivityMs > LIVE_IDLE_TTL_MS
      ) {
        this.drop(key, entry);
      }
    }
  }

  /** Memory pressure: unwatched entries leave first, oldest activity first. */
  private evict(forEntryCount = false): void {
    const over = () =>
      forEntryCount
        ? this.entries.size >= LIVE_MAX_ENTRIES
        : this.totalBytes > LIVE_MAX_TOTAL_BYTES;
    const byAge = [...this.entries].sort((a, b) => a[1].lastActivityMs - b[1].lastActivityMs);
    for (const watched of [false, true]) {
      for (const [key, entry] of byAge) {
        if (!over()) return;
        if (entry.subscribers.size > 0 !== watched) continue;
        for (const sub of entry.subscribers) sub.close();
        this.drop(key, entry);
      }
    }
  }

  private drop(key: string, entry: LiveSessionEntry): void {
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
  }
}

/** Keeps the snapshot state bounded: fewer bodies, fewer items. */
function trimState(state: LiveState): void {
  if (state.items.length > STATE_MAX_ITEMS) {
    state.items.splice(0, state.items.length - STATE_MAX_ITEMS);
  }
  let kept = 0;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]!;
    if (item.kind !== 'attempt' || (item.body === undefined && item.headers === undefined))
      continue;
    if (++kept > STATE_BODIES_KEPT) {
      delete item.body;
      delete item.headers;
    }
  }
}

function stripStateForViewer(state: LiveState, access: LiveViewerAccess): void {
  for (const item of state.items) {
    if (item.kind !== 'attempt') continue;
    const attempt = item as LiveAttempt;
    if (!access.headers) delete attempt.headers;
    if (!access.bodies) delete attempt.body;
  }
}
