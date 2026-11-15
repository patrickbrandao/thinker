/**
 * Live session feed: the wire contract between the gateway and the live
 * session window (docs/dev/janela-sessao-ao-vivo.md), and the reducer that
 * turns the event stream into the window state. The backend uses the same
 * reducer to build the `snapshot` a client gets when it joins.
 */

export type LiveWireFormat =
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'google_generate_content'
  | 'google_code_assist'
  | 'kiro_chat';

export type LiveEventType =
  | 'snapshot'
  | 'message.appended'
  | 'conversation.reset'
  | 'request.started'
  | 'block.started'
  | 'block.delta'
  | 'block.stopped'
  | 'request.completed'
  | 'request.failed'
  | 'request.cancelled';

export interface LiveEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Increasing per session, no gaps: the Last-Event-ID. */
  id: number;
  type: LiveEventType;
  /** Server clock, epoch ms. */
  ts: number;
  data: T;
}

export type LiveBlockType = 'thinking' | 'text' | 'tool_use';

export interface LiveSessionMeta {
  sessionId: string;
  agentName: string | null;
  harness: string | null;
}

export interface LiveConversationMessage {
  role: 'system' | 'user' | 'tool';
  text: string;
  name?: string;
  toolCallId?: string;
  isError?: boolean;
}

export interface LiveUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

export interface LiveBlock {
  type: LiveBlockType;
  text: string;
  /** Deltas as they arrived (the Inspector rebuilds the provider frames from them). */
  chunks: string[];
  name?: string;
  toolCallId?: string;
  /** Thinking the provider only returns encrypted. */
  redacted?: boolean;
  done: boolean;
  startedTs: number;
  endedTs?: number;
}

export type LiveAttemptStatus = 'waiting' | 'streaming' | 'done' | 'failed' | 'cancelled';

export interface LiveAttempt {
  kind: 'attempt';
  requestId: string;
  attemptId: string;
  attempt: number;
  model: string;
  provider: string;
  route: string | null;
  upstream: LiveWireFormat | null;
  endpoint: string | null;
  /** Present only with recording on and for viewers allowed to see bodies. */
  headers?: Record<string, string>;
  body?: unknown;
  status: LiveAttemptStatus;
  startedTs: number;
  endedTs?: number;
  blocks: LiveBlock[];
  stopReason?: string | null;
  usage?: LiveUsage | null;
  costUsd?: number | null;
  ttftMs?: number | null;
  latencyMs?: number | null;
  error?: {
    status: number | null;
    message: string;
    errorClass?: string | null;
    next: 'fallback' | 'give_up';
    interrupted?: boolean;
  };
}

export interface LiveMessage extends LiveConversationMessage {
  kind: 'message';
  seq: number;
  ts: number;
}

export type LiveItem = LiveAttempt | LiveMessage;

export interface LiveState {
  lastEventId: number;
  /** Server time of the last applied event (the "now" of a replay). */
  lastTs: number;
  items: LiveItem[];
  totals: { requests: number; input: number; output: number; costUsd: number };
}

// ------------------------------------------------------------ event payloads

export interface LiveSnapshotData {
  session: LiveSessionMeta;
  state: LiveState;
  [k: string]: unknown;
}

export interface LiveRequestStartedData {
  requestId: string;
  attemptId: string;
  attempt: number;
  model: string;
  provider: string;
  route?: string | null;
  upstream?: LiveWireFormat | null;
  endpoint?: string | null;
  headers?: Record<string, string>;
  body?: unknown;
  [k: string]: unknown;
}

export const emptyLiveState = (): LiveState => ({
  lastEventId: 0,
  lastTs: 0,
  items: [],
  totals: { requests: 0, input: 0, output: 0, costUsd: 0 },
});

function findAttempt(s: LiveState, attemptId: unknown): LiveAttempt | undefined {
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i]!;
    if (it.kind === 'attempt' && it.attemptId === attemptId) return it;
  }
  return undefined;
}

function nextSeq(s: LiveState): number {
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i]!;
    if (it.kind === 'message') return it.seq + 1;
  }
  return 0;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// State is plain JSON (it travels in the snapshot), so a JSON round trip is a full copy.
const deepClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Applies one event to the state, mutating it in place (callers batch their
 * renders). Unknown attempt ids are ignored, so a client that joined late or
 * missed events never throws.
 */
export function applyLiveEvent(s: LiveState, ev: LiveEvent): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = ev.data as Record<string, any>;
  if (ev.type === 'snapshot') {
    Object.assign(s, deepClone((d as LiveSnapshotData).state));
    s.lastEventId = ev.id;
    return;
  }
  s.lastEventId = ev.id;
  s.lastTs = ev.ts;
  switch (ev.type) {
    case 'message.appended':
      s.items.push({
        kind: 'message',
        seq: typeof d.seq === 'number' ? d.seq : nextSeq(s),
        role: d.role,
        text: String(d.text ?? ''),
        name: d.name,
        toolCallId: d.toolCallId,
        isError: d.isError,
        ts: ev.ts,
      });
      break;
    case 'conversation.reset': {
      // The harness rewrote its history: keep the attempts (what really
      // happened on the wire) and replace the messages with the new list.
      s.items = s.items.filter((i) => i.kind === 'attempt');
      const messages = (Array.isArray(d.messages) ? d.messages : []) as LiveConversationMessage[];
      messages.forEach((m, k) => s.items.push({ kind: 'message', seq: k, ts: ev.ts, ...m }));
      break;
    }
    case 'request.started':
      if (d.attempt === 1) s.totals.requests += 1;
      s.items.push({
        kind: 'attempt',
        requestId: d.requestId,
        attemptId: d.attemptId,
        attempt: d.attempt ?? 1,
        model: d.model,
        provider: d.provider,
        route: d.route ?? null,
        upstream: d.upstream ?? null,
        endpoint: d.endpoint ?? null,
        ...(d.headers ? { headers: d.headers } : {}),
        ...(d.body !== undefined ? { body: d.body } : {}),
        status: 'waiting',
        startedTs: ev.ts,
        blocks: [],
      });
      break;
    case 'block.started': {
      const a = findAttempt(s, d.attemptId);
      if (!a) break;
      a.status = 'streaming';
      a.blocks[d.index] = {
        type: d.type,
        text: '',
        chunks: [],
        name: d.name,
        toolCallId: d.toolCallId,
        ...(d.redacted ? { redacted: true } : {}),
        done: false,
        startedTs: ev.ts,
      };
      break;
    }
    case 'block.delta': {
      const b = findAttempt(s, d.attemptId)?.blocks[d.index];
      if (b && typeof d.delta === 'string') {
        b.text += d.delta;
        b.chunks.push(d.delta);
      }
      break;
    }
    case 'block.stopped': {
      const b = findAttempt(s, d.attemptId)?.blocks[d.index];
      if (b) {
        b.done = true;
        b.endedTs = ev.ts;
      }
      break;
    }
    case 'request.completed': {
      const a = findAttempt(s, d.attemptId);
      if (!a) break;
      for (const b of a.blocks) if (b && !b.done) Object.assign(b, { done: true, endedTs: ev.ts });
      Object.assign(a, {
        status: 'done',
        endedTs: ev.ts,
        stopReason: d.stopReason ?? null,
        usage: d.usage ?? null,
        costUsd: d.costUsd ?? null,
        ttftMs: d.ttftMs ?? null,
        latencyMs: d.latencyMs ?? null,
      });
      s.totals.input += num(d.usage?.input);
      s.totals.output += num(d.usage?.output);
      s.totals.costUsd += num(d.costUsd);
      break;
    }
    case 'request.failed':
    case 'request.cancelled': {
      const a = findAttempt(s, d.attemptId);
      if (!a) break;
      for (const b of a.blocks) if (b && !b.done) b.endedTs = ev.ts;
      if (ev.type === 'request.failed') {
        Object.assign(a, {
          status: 'failed',
          endedTs: ev.ts,
          latencyMs: d.latencyMs ?? null,
          error: {
            status: d.status ?? null,
            message: String(d.message ?? ''),
            errorClass: d.errorClass ?? null,
            next: d.next === 'fallback' ? 'fallback' : 'give_up',
            interrupted: !!d.interrupted,
          },
        });
      } else {
        Object.assign(a, {
          status: 'cancelled',
          endedTs: ev.ts,
          stopReason: d.reason ?? 'client_closed',
          latencyMs: d.latencyMs ?? null,
          usage: d.usage ?? null,
        });
        s.totals.input += num(d.usage?.input);
        s.totals.output += num(d.usage?.output);
      }
      break;
    }
  }
}

/** Rebuilds the state from a list of events (a replay from history). */
export function reduceLiveEvents(events: LiveEvent[]): LiveState {
  const s = emptyLiveState();
  for (const ev of events) applyLiveEvent(s, ev);
  return s;
}

// ---------------------------------------------- provider frames (Inspector)

const sseFrame = (event: string | null, data: unknown) =>
  `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n`;

/**
 * The provider's own stream for one attempt, rebuilt in its wire format from
 * the recorded deltas. Not byte-identical to what the provider sent (the
 * recording has those): it shows the shape and order of the stream.
 */
export function liveProviderFrames(a: LiveAttempt): string[] {
  const out: string[] = [];
  const done = a.status === 'done';
  const blocks = a.blocks.filter(Boolean);
  if (a.upstream === 'anthropic_messages') {
    out.push(
      sseFrame('message_start', {
        type: 'message_start',
        message: { model: a.model, role: 'assistant', content: [] },
      }),
    );
    blocks.forEach((b, index) => {
      const start =
        b.type === 'tool_use'
          ? { type: 'tool_use', id: b.toolCallId, name: b.name, input: {} }
          : b.type === 'thinking'
            ? { type: b.redacted ? 'redacted_thinking' : 'thinking', thinking: '' }
            : { type: 'text', text: '' };
      out.push(
        sseFrame('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: start,
        }),
      );
      for (const c of b.chunks) {
        const delta =
          b.type === 'thinking'
            ? { type: 'thinking_delta', thinking: c }
            : b.type === 'text'
              ? { type: 'text_delta', text: c }
              : { type: 'input_json_delta', partial_json: c };
        out.push(sseFrame('content_block_delta', { type: 'content_block_delta', index, delta }));
      }
      if (b.done) out.push(sseFrame('content_block_stop', { type: 'content_block_stop', index }));
    });
    if (done) {
      out.push(
        sseFrame('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: a.stopReason },
          usage: { output_tokens: a.usage?.output },
        }),
      );
      out.push(sseFrame('message_stop', { type: 'message_stop' }));
    }
  } else if (a.upstream === 'openai_responses') {
    out.push(
      sseFrame('response.created', {
        type: 'response.created',
        response: { model: a.model, status: 'in_progress' },
      }),
    );
    blocks.forEach((b, output_index) => {
      const item =
        b.type === 'thinking'
          ? { type: 'reasoning' }
          : b.type === 'text'
            ? { type: 'message', role: 'assistant' }
            : { type: 'function_call', call_id: b.toolCallId, name: b.name };
      out.push(
        sseFrame('response.output_item.added', {
          type: 'response.output_item.added',
          output_index,
          item,
        }),
      );
      const ev =
        b.type === 'thinking'
          ? 'response.reasoning_summary_text.delta'
          : b.type === 'text'
            ? 'response.output_text.delta'
            : 'response.function_call_arguments.delta';
      for (const c of b.chunks) out.push(sseFrame(ev, { type: ev, output_index, delta: c }));
      if (b.done)
        out.push(
          sseFrame('response.output_item.done', {
            type: 'response.output_item.done',
            output_index,
          }),
        );
    });
    if (done)
      out.push(
        sseFrame('response.completed', {
          type: 'response.completed',
          response: {
            status: 'completed',
            usage: {
              input_tokens: a.usage?.input,
              output_tokens: a.usage?.output,
              output_tokens_details: { reasoning_tokens: a.usage?.reasoning ?? 0 },
            },
          },
        }),
      );
  } else if (a.upstream === 'google_generate_content' || a.upstream === 'google_code_assist') {
    for (const b of blocks)
      for (const c of b.chunks) {
        const part =
          b.type === 'thinking'
            ? { text: c, thought: true }
            : b.type === 'text'
              ? { text: c }
              : { functionCall: { name: b.name, args: c } };
        out.push(sseFrame(null, { candidates: [{ content: { role: 'model', parts: [part] } }] }));
      }
    if (done)
      out.push(
        sseFrame(null, {
          candidates: [{ finishReason: a.stopReason }],
          usageMetadata: {
            promptTokenCount: a.usage?.input,
            candidatesTokenCount: a.usage?.output,
          },
        }),
      );
  } else {
    let toolIndex = 0;
    for (const b of blocks) {
      const ti = b.type === 'tool_use' ? toolIndex++ : 0;
      b.chunks.forEach((c, k) => {
        const delta =
          b.type === 'thinking'
            ? { reasoning_content: c }
            : b.type === 'text'
              ? { content: c }
              : {
                  tool_calls: [
                    {
                      index: ti,
                      ...(k === 0
                        ? {
                            id: b.toolCallId,
                            type: 'function',
                            function: { name: b.name, arguments: c },
                          }
                        : { function: { arguments: c } }),
                    },
                  ],
                };
        out.push(sseFrame(null, { model: a.model, choices: [{ index: 0, delta }] }));
      });
    }
    if (done) {
      out.push(
        sseFrame(null, {
          choices: [{ index: 0, delta: {}, finish_reason: a.stopReason }],
          usage: { prompt_tokens: a.usage?.input, completion_tokens: a.usage?.output },
        }),
      );
      out.push(sseFrame(null, '[DONE]'));
    }
  }
  return out;
}

/** Status of the session for the window title chip. */
export type LiveSessionStatus =
  | 'idle'
  | 'waiting'
  | 'streaming'
  | 'retrying'
  | 'tools'
  | 'finished'
  | 'cancelled'
  | 'failed'
  | 'waiting_request';

export function liveSessionStatus(state: LiveState): LiveSessionStatus {
  const last = state.items.at(-1);
  if (!last) return 'idle';
  // Concurrent requests: any attempt still on the wire wins.
  if (state.items.some((i) => i.kind === 'attempt' && i.status === 'streaming')) return 'streaming';
  if (last.kind === 'attempt') {
    if (last.status === 'waiting') return last.attempt > 1 ? 'retrying' : 'waiting';
    if (last.status === 'streaming') return 'streaming';
    if (last.status === 'failed') return last.error?.next === 'give_up' ? 'failed' : 'retrying';
    if (last.status === 'cancelled') return 'cancelled';
    if (last.stopReason === 'tool_use' || last.stopReason === 'tool_calls') return 'tools';
    return 'finished';
  }
  if (last.role === 'tool') return 'tools';
  return 'waiting_request';
}
