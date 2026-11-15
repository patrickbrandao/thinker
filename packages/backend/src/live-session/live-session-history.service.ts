import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  isSuccessStatus,
  reduceLiveEvents,
  type LiveEvent,
  type LiveEventType,
  type LiveSessionMeta,
  type LiveState,
  type LiveWireFormat,
} from 'thinker-shared';
import { RequestRecordingStorageService } from '../common/services/request-recording-storage.service';
import { decodeRequestRecording } from '../common/utils/request-recording-codec';
import type { StoredAttemptRecording } from '../routing/proxy/attempt-recording.types';
import type { RequestTimelineEvent } from '../routing/proxy/request-timeline';
import { redactInlineImageDataUrls } from '../routing/proxy/inline-image-redaction';
import { ConversationTracker, normalizeConversation } from './live-conversation';
import { LiveSessionHubService, type LiveSessionEntry } from './live-session-hub.service';
import { LiveStreamNormalizer, type LiveBlockOp } from './live-stream-normalizer';
import { LIVE_MAX_BODY_BYTES } from './live-request-capture';
import {
  displayModel,
  eventForViewer,
  fillTitle,
  harnessName,
  providerDisplayName,
  type LiveSessionMetaWire,
  type LiveViewerAccess,
} from './live-wire';

/** Requests synthesized at most per session (the oldest first). */
export const HISTORY_MAX_REQUESTS = 1000;
export const EVENTS_DEFAULT_LIMIT = 1000;
export const EVENTS_MAX_LIMIT = 5000;
/** Request bodies one `/events` page carries at most; later ones become a marker. */
const PAGE_BODY_BUDGET = 8 * 1024 * 1024;
/** Attempts whose bodies a snapshot seed carries (like the hub state). */
const SEED_BODIES = 10;
const RECORDING_CONCURRENCY = 6;
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 8;

type Row = Record<string, unknown>;

interface SynthEvent {
  type: LiveEventType;
  ts: number;
  data: Record<string, unknown>;
}

interface Synthesis {
  meta: LiveSessionMeta;
  events: LiveEvent[];
  /** request.started event id → recording key, to attach bodies on demand. */
  bodies: Map<number, string>;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ms = (v: unknown): number => (v instanceof Date ? v.getTime() : Date.parse(String(v)));

function parseJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

/**
 * Replay of a session from what the database keeps: `requests` (ordered by
 * `timeline.received`), their attempts and the attempt recordings, through
 * the same normalizer and conversation diff as the live capture. Without a
 * recording an attempt keeps its structure (model, status, tokens, cost,
 * times) and has no blocks or messages. Ids are 1, 2, 3… in event order, so
 * the same data always gives the same ids.
 */
@Injectable()
export class LiveSessionHistoryService {
  private readonly logger = new Logger(LiveSessionHistoryService.name);
  private readonly cache = new Map<string, { at: number; fingerprint: string; value: Synthesis }>();

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly hub: LiveSessionHubService,
    @Optional() private readonly storage?: RequestRecordingStorageService,
  ) {}

  /** The same visibility as `GET /api/v1/sessions/:id`. */
  async exists(tenantId: string, sessionId: string): Promise<boolean> {
    const rows = (await this.ds.query(
      `SELECT 1 FROM requests
        WHERE tenant_id = $1 AND (session_id = $2 OR parent_session_id = $2)
        LIMIT 1`,
      [tenantId, sessionId],
    )) as Row[];
    return rows.length > 0;
  }

  async meta(tenantId: string, sessionId: string): Promise<LiveSessionMeta> {
    const rows = (await this.ds.query(
      `SELECT agent_name, request_headers FROM requests
        WHERE tenant_id = $1 AND session_id = $2
        ORDER BY timestamp DESC LIMIT 1`,
      [tenantId, sessionId],
    )) as Row[];
    const row = rows[0];
    return {
      sessionId,
      agentName: (row?.agent_name as string | null | undefined) ?? null,
      harness: harnessName(parseJson<Record<string, string>>(row?.request_headers)),
    };
  }

  /** What happened before a hub entry existed, as reducer state. */
  async seedState(entry: LiveSessionEntry, access: LiveViewerAccess): Promise<LiveState | null> {
    const synthesis = await this.synthesize(entry.tenantId, entry.sessionId, entry);
    if (synthesis.events.length === 0) return null;
    const events = await this.withBodies(synthesis, synthesis.events, access, SEED_BODIES);
    return reduceLiveEvents(events);
  }

  /** `GET /sessions/:id/events`: buffer when the hub has it whole, else database. */
  async events(
    tenantId: string,
    sessionId: string,
    access: LiveViewerAccess,
    page: { after: number; until: number | null; limit: number },
  ): Promise<{ session: LiveSessionMeta; events: LiveEvent[]; next_after: number | null }> {
    const entry = this.hub.find(tenantId, sessionId);
    let all: LiveEvent[];
    let session: LiveSessionMeta;
    let synthesis: Synthesis | null = null;
    if (entry && !entry.dropped && entry.events.length > 0) {
      synthesis = await this.synthesize(tenantId, sessionId, entry);
      const buffered = entry.events.map((e) => eventForViewer(e.event, access));
      const lastSeed = synthesis.events.at(-1)?.id ?? 0;
      all = lastSeed < entry.firstBufferedId ? [...synthesis.events, ...buffered] : buffered;
      session = entry.meta;
    } else {
      synthesis = await this.synthesize(tenantId, sessionId, null);
      all = synthesis.events;
      session = synthesis.meta;
    }
    const inRange = all.filter(
      (e) => e.id > page.after && (page.until === null || e.id <= page.until),
    );
    const slice = inRange.slice(0, page.limit);
    const events = await this.withBodies(synthesis, slice, access, Infinity);
    return {
      session,
      events,
      next_after: inRange.length > slice.length && slice.length > 0 ? slice.at(-1)!.id : null,
    };
  }

  /** Attaches recorded request bodies to synthesized `request.started` events. */
  private async withBodies(
    synthesis: Synthesis | null,
    events: LiveEvent[],
    access: LiveViewerAccess,
    maxBodies: number,
  ): Promise<LiveEvent[]> {
    if (!synthesis || !access.bodies || synthesis.bodies.size === 0) return events;
    const wanted = events
      .filter((e) => e.type === 'request.started' && synthesis.bodies.has(e.id))
      .slice(Number.isFinite(maxBodies) ? -maxBodies : 0);
    const loaded = new Map<number, unknown>();
    await mapLimit(wanted, RECORDING_CONCURRENCY, async (e) => {
      const recording = await this.loadRecording(synthesis.bodies.get(e.id)!);
      if (recording) loaded.set(e.id, redactInlineImageDataUrls(recording.request_body));
    });
    let budget = PAGE_BODY_BUDGET;
    return events.map((e) => {
      if (!loaded.has(e.id)) return e;
      const body = loaded.get(e.id);
      const size = JSON.stringify(body).length;
      if (size > LIVE_MAX_BODY_BYTES || size > budget) {
        return {
          ...e,
          data: {
            ...e.data,
            body: {
              _thinker: 'Body omitted from this page; see the attempt recording.',
              bytes: size,
            },
          },
        };
      }
      budget -= size;
      return { ...e, data: { ...e.data, body } };
    });
  }

  /**
   * Events of the session's own requests (`session_id = id`; subagents are
   * their own sessions). With `entry`, only requests the entry never saw and
   * that began before it existed.
   */
  async synthesize(
    tenantId: string,
    sessionId: string,
    entry: LiveSessionEntry | null,
  ): Promise<Synthesis> {
    const requests = (
      (await this.ds.query(
        `SELECT id, timestamp, status, agent_name, timeline, request_headers
         FROM requests
        WHERE tenant_id = $1 AND session_id = $2
        ORDER BY timestamp ASC, id ASC
        LIMIT ${HISTORY_MAX_REQUESTS}`,
        [tenantId, sessionId],
      )) as Row[]
    ).filter(
      (r) =>
        !entry || (!entry.requestIds.has(String(r.id)) && ms(r.timestamp) <= entry.createdAtMs),
    );
    const attempts =
      requests.length === 0
        ? []
        : ((await this.ds.query(
            `SELECT id, request_id, attempt_number, timestamp, duration_ms, status, model,
                    provider, routing_tier, virtual_model_name, error_message,
                    error_http_status, error_class, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, cost_usd, recording_key
               FROM agent_messages
              WHERE tenant_id = $1 AND request_id = ANY($2)
              ORDER BY attempt_number ASC NULLS LAST, timestamp ASC, id ASC`,
            [tenantId, requests.map((r) => String(r.id))],
          )) as Row[]);

    const fingerprint =
      requests.map((r) => `${String(r.id)}:${String(r.status)}`).join(',') +
      '|' +
      attempts
        .map((a) => `${String(a.id)}:${String(a.status)}:${a.recording_key ? 1 : 0}`)
        .join(',');
    const cacheKey = `${tenantId}\u0000${sessionId}\u0000${entry ? entry.createdAtMs : ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }

    const value = await this.build(tenantId, sessionId, requests, attempts);
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, { at: Date.now(), fingerprint, value });
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  private async build(
    tenantId: string,
    sessionId: string,
    requests: Row[],
    attempts: Row[],
  ): Promise<Synthesis> {
    const customNames = await this.customNames(tenantId);
    const byRequest = new Map<string, Row[]>();
    for (const a of attempts) {
      const list = byRequest.get(String(a.request_id)) ?? [];
      list.push(a);
      byRequest.set(String(a.request_id), list);
    }
    const ordered = requests
      .map((r) => {
        const timeline = parseJson<{ events?: RequestTimelineEvent[] }>(r.timeline)?.events ?? [];
        const received = timeline.find((e) => e.type === 'received')?.at ?? ms(r.timestamp);
        return { row: r, timeline, received };
      })
      .sort((a, b) => a.received - b.received || String(a.row.id).localeCompare(String(b.row.id)));

    const out: Array<SynthEvent & { order: number }> = [];
    let order = 0;
    const push = (type: LiveEventType, ts: number, data: Record<string, unknown>) =>
      out.push({ type, ts, data, order: order++ });
    const bodyKeys: Array<{ order: number; key: string }> = [];
    const tracker = new ConversationTracker();

    for (const { row, timeline, received } of ordered) {
      const requestId = String(row.id);
      const skipped = new Set(
        timeline.filter((e) => e.type === 'provider_skipped').map((e) => e.attempt),
      );
      const rows = (byRequest.get(requestId) ?? []).filter(
        (a) => a.attempt_number == null || !skipped.has(num(a.attempt_number)),
      );
      const recordings = await mapLimit(rows, RECORDING_CONCURRENCY, (a) =>
        a.recording_key ? this.loadRecording(String(a.recording_key)) : Promise.resolve(null),
      );

      // Messages: the first attempt's recorded request, through the prefix diff.
      const first = recordings[0];
      if (first) {
        const diff = tracker.diff(
          normalizeConversation(first.request_body, first.wire_format as LiveWireFormat),
        );
        if (diff.kind === 'reset')
          push('conversation.reset', received, { messages: diff.messages });
        else if (diff.kind === 'append') {
          let seq = tracker.visibleCount - diff.messages.length;
          for (const m of diff.messages) push('message.appended', received, { seq: seq++, ...m });
        }
      }

      rows.forEach((a, i) => {
        const n = i + 1;
        const attemptId = `${requestId}.${n}`;
        const recording = recordings[i] ?? null;
        const number = a.attempt_number == null ? null : num(a.attempt_number);
        const mark = (type: RequestTimelineEvent['type']) =>
          timeline.find((e) => e.type === type && (number === null || e.attempt === number))?.at;
        const startTs = mark('provider_request') ?? ms(a.timestamp);
        const firstChunk = mark('first_chunk');
        const lastChunk = mark('last_chunk');
        const duration = a.duration_ms == null ? null : num(a.duration_ms);
        // `duration_ms` can stop at the response headers; the last chunk is the real end.
        const endTs = Math.max(
          startTs,
          duration !== null ? startTs + duration : startTs,
          lastChunk ?? startTs,
        );
        const latencyMs = lastChunk != null ? endTs - startTs : duration;
        const status = String(a.status ?? 'ok');
        const ok = a.status == null || isSuccessStatus(status);
        const routeBase = a.virtual_model_name
          ? `virtual model: ${String(a.virtual_model_name)}`
          : a.routing_tier
            ? `tier: ${String(a.routing_tier)}`
            : null;
        const route = [routeBase, n > 1 ? `fallback #${n - 1}` : null].filter(Boolean).join(' · ');
        push('request.started', startTs, {
          requestId,
          attemptId,
          attempt: n,
          model: displayModel(a.model as string | null),
          provider: providerDisplayName(a.provider as string | null, customNames),
          route: route || null,
          upstream: (recording?.wire_format as LiveWireFormat | undefined) ?? null,
          endpoint: null,
        });
        if (recording && a.recording_key)
          bodyKeys.push({ order: order - 1, key: String(a.recording_key) });

        // Blocks: the recorded response through the live normalizer, spread
        // evenly between the first and last chunk.
        const ops: LiveBlockOp[] = [];
        const normalizer = new LiveStreamNormalizer(
          (recording?.wire_format as LiveWireFormat | undefined) ?? null,
          (op) => ops.push(op),
        );
        const response = recording?.response_body;
        if (response?.type === 'stream' && response.raw_sse) {
          normalizer.feedSse(response.raw_sse);
          normalizer.endSse();
        } else if (response?.type === 'json') {
          normalizer.feedBody(response.body);
        }
        if (ok) normalizer.finish();
        const spanStart = Math.max(startTs, firstChunk ?? startTs);
        const spanEnd = Math.max(spanStart, lastChunk ?? endTs);
        let lastTs = startTs;
        ops.forEach((op, k) => {
          const ts =
            ops.length === 1
              ? spanStart
              : Math.round(spanStart + ((spanEnd - spanStart) * k) / (ops.length - 1));
          lastTs = Math.max(lastTs, ts);
          const ids = { requestId, attemptId, index: op.index };
          if (op.op === 'start') {
            push('block.started', lastTs, {
              ...ids,
              type: op.type,
              ...(op.name !== undefined ? { name: op.name } : {}),
              ...(op.toolCallId !== undefined ? { toolCallId: op.toolCallId } : {}),
              ...(op.redacted ? { redacted: true } : {}),
            });
          } else if (op.op === 'delta') {
            push('block.delta', lastTs, { ...ids, delta: op.delta });
          } else {
            push('block.stopped', lastTs, ids);
          }
        });

        const doneTs = Math.max(endTs, lastTs);
        if (status === 'pending') return;
        if (ok) {
          push('request.completed', doneTs, {
            requestId,
            attemptId,
            stopReason: normalizer.stopReason,
            usage: {
              input: num(a.input_tokens),
              output: num(a.output_tokens),
              cacheRead: num(a.cache_read_tokens),
              cacheWrite: num(a.cache_creation_tokens),
              reasoning: normalizer.reasoningTokens,
            },
            costUsd: a.cost_usd == null ? null : Math.max(0, num(a.cost_usd)),
            ttftMs: firstChunk != null ? firstChunk - startTs : null,
            latencyMs,
          });
        } else if (status === 'cancelled') {
          push('request.cancelled', doneTs, {
            requestId,
            attemptId,
            reason: 'client_closed',
            latencyMs,
          });
        } else {
          push('request.failed', doneTs, {
            requestId,
            attemptId,
            status: a.error_http_status == null ? null : num(a.error_http_status),
            message: String(a.error_message ?? 'Provider attempt failed'),
            errorClass: (a.error_class as string | null) ?? null,
            interrupted: normalizer.blockCount > 0,
            next: i < rows.length - 1 ? 'fallback' : 'give_up',
            latencyMs,
          });
        }
      });
    }

    // Concurrent requests interleave by time; within an attempt the order of
    // generation is kept (its times never go backwards).
    out.sort((a, b) => a.ts - b.ts || a.order - b.order);
    const idByOrder = new Map<number, number>();
    const events: LiveEvent[] = out.map((e, i) => {
      idByOrder.set(e.order, i + 1);
      return { id: i + 1, type: e.type, ts: e.ts, data: e.data };
    });
    const bodies = new Map<number, string>();
    for (const { order: o, key } of bodyKeys) bodies.set(idByOrder.get(o)!, key);

    const latest = ordered.at(-1)?.row;
    const meta: LiveSessionMetaWire = {
      sessionId,
      agentName: (latest?.agent_name as string | null | undefined) ?? null,
      harness: harnessName(parseJson<Record<string, string>>(latest?.request_headers)),
    };
    for (const e of events) {
      if (meta.title) break;
      if (e.type === 'message.appended')
        fillTitle(meta, [e.data as { role: string; text: string }]);
      else if (e.type === 'conversation.reset') {
        fillTitle(meta, (e.data.messages ?? []) as Array<{ role: string; text: string }>);
      }
    }
    return { meta, events, bodies };
  }

  private async customNames(tenantId: string): Promise<Map<string, string>> {
    try {
      const rows = (await this.ds.query(
        'SELECT id, name FROM custom_providers WHERE tenant_id = $1',
        [tenantId],
      )) as Array<{ id: string; name: string }>;
      return new Map(rows.map((r) => [String(r.id), String(r.name)]));
    } catch {
      return new Map();
    }
  }

  private async loadRecording(key: string): Promise<StoredAttemptRecording | null> {
    if (!this.storage?.backend) return null;
    try {
      return await decodeRequestRecording(await this.storage.get(key));
    } catch (error) {
      this.logger.warn(`Live session replay: recording ${key} unreadable: ${String(error)}`);
      return null;
    }
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}
