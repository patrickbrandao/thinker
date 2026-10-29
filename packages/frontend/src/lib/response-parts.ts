import type { AttemptRecording } from '../services/api/messages.js';

/**
 * Readable parts of one provider response, across the wire formats Thinker
 * records (OpenAI chat completions, Responses API, Anthropic Messages, Gemini),
 * streamed or whole. Parts keep the order the provider produced them.
 */
export type ResponsePart =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'refusal'; text: string }
  | { kind: 'tool_call'; id?: string; name?: string; arguments: string };

export interface StreamEvent {
  index: number;
  /** SSE `event:` name, or the payload's own `type`/`object`. */
  name: string;
  data: unknown;
  raw: string;
}

export interface ParsedResponse {
  mode: 'stream' | 'json' | 'none';
  parts: ResponsePart[];
  events: StreamEvent[];
  /** Summary fields: id, model, finish reason, usage. */
  meta: Record<string, unknown>;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Accumulates streamed fragments, merging consecutive fragments of one part. */
class PartBuilder {
  parts: ResponsePart[] = [];
  private calls = new Map<string, Extract<ResponsePart, { kind: 'tool_call' }>>();

  text(kind: 'thinking' | 'text' | 'refusal', fragment: string | undefined): void {
    if (!fragment) return;
    const last = this.parts[this.parts.length - 1];
    if (last && last.kind === kind) last.text += fragment;
    else this.parts.push({ kind, text: fragment });
  }

  call(key: string, patch: { id?: string; name?: string; args?: string; replaceArgs?: boolean }) {
    let call = this.calls.get(key);
    if (!call) {
      call = { kind: 'tool_call', arguments: '' };
      this.calls.set(key, call);
      this.parts.push(call);
    }
    if (patch.id) call.id = patch.id;
    if (patch.name) call.name = (patch.replaceArgs ? '' : (call.name ?? '')) + patch.name;
    if (patch.args != null)
      call.arguments = patch.replaceArgs ? patch.args : call.arguments + patch.args;
  }
}

function argsText(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function parseSseEvents(raw: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    let name = '';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    const joined = data.join('\n');
    let parsed: unknown = joined;
    try {
      parsed = JSON.parse(joined);
    } catch {
      // `[DONE]` and other non-JSON data stay as text.
    }
    if (!name && isRec(parsed)) name = str(parsed.type) ?? str(parsed.object) ?? '';
    if (!name && joined.trim() === '[DONE]') name = 'done';
    if (!joined && !name) continue;
    events.push({ index: events.length, name: name || 'data', data: parsed, raw: block });
  }
  return events;
}

function captureMeta(meta: Rec, payload: Rec): void {
  const inner = isRec(payload.response)
    ? payload.response
    : isRec(payload.message)
      ? payload.message
      : payload;
  for (const key of ['id', 'model', 'modelVersion', 'status'] as const) {
    if (inner[key] != null && typeof inner[key] !== 'object') meta[key] = inner[key];
  }
  const usage = inner.usage ?? payload.usage ?? inner.usageMetadata ?? payload.usageMetadata;
  if (isRec(usage)) meta.usage = { ...(isRec(meta.usage) ? meta.usage : {}), ...usage };
  const choice = Array.isArray(payload.choices) ? payload.choices.find(isRec) : undefined;
  if (choice?.finish_reason) meta.finish_reason = choice.finish_reason;
  const delta = isRec(payload.delta) ? payload.delta : undefined;
  if (delta?.stop_reason) meta.stop_reason = delta.stop_reason;
  if (inner.stop_reason) meta.stop_reason = inner.stop_reason;
  const candidate = Array.isArray(payload.candidates) ? payload.candidates.find(isRec) : undefined;
  if (candidate?.finishReason) meta.finish_reason = candidate.finishReason;
}

function geminiParts(b: PartBuilder, content: unknown, key: string): void {
  if (!isRec(content) || !Array.isArray(content.parts)) return;
  content.parts.filter(isRec).forEach((part, i) => {
    if (typeof part.text === 'string')
      b.text(part.thought === true ? 'thinking' : 'text', part.text);
    if (isRec(part.functionCall)) {
      b.call(`${key}:${i}:${String(part.functionCall.name)}`, {
        name: str(part.functionCall.name),
        args: argsText(part.functionCall.args),
        replaceArgs: true,
      });
    }
  });
}

function streamPayload(b: PartBuilder, p: Rec, meta: Rec, eventIndex: number): void {
  captureMeta(meta, p);
  // OpenAI chat completions (and compatible providers' reasoning fields).
  const choice = Array.isArray(p.choices) ? p.choices.find(isRec) : undefined;
  const delta = choice && isRec(choice.delta) ? choice.delta : undefined;
  if (delta) {
    b.text('thinking', str(delta.reasoning_content) ?? str(delta.reasoning));
    b.text('text', str(delta.content));
    b.text('refusal', str(delta.refusal));
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls.filter(isRec)) {
        const fn = isRec(call.function) ? call.function : {};
        b.call(`chat:${String(call.index ?? 0)}`, {
          id: str(call.id),
          name: str(fn.name),
          args: str(fn.arguments),
        });
      }
    }
  }
  // Anthropic Messages.
  if (p.type === 'content_block_start' && isRec(p.content_block)) {
    const block = p.content_block;
    if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      b.call(`anthropic:${String(p.index ?? 0)}`, {
        id: str(block.id),
        name: str(block.name),
        args:
          isRec(block.input) && Object.keys(block.input).length > 0 ? argsText(block.input) : '',
      });
    }
    if (block.type === 'thinking') b.text('thinking', str(block.thinking));
    if (block.type === 'text') b.text('text', str(block.text));
  }
  if (p.type === 'content_block_delta' && isRec(p.delta)) {
    const d = p.delta;
    if (d.type === 'thinking_delta') b.text('thinking', str(d.thinking));
    if (d.type === 'text_delta') b.text('text', str(d.text));
    if (d.type === 'input_json_delta') {
      b.call(`anthropic:${String(p.index ?? 0)}`, { args: str(d.partial_json) });
    }
  }
  // Responses API.
  if (p.type === 'response.output_text.delta') b.text('text', str(p.delta));
  if (p.type === 'response.refusal.delta') b.text('refusal', str(p.delta));
  if (
    p.type === 'response.reasoning_summary_text.delta' ||
    p.type === 'response.reasoning_text.delta'
  ) {
    b.text('thinking', str(p.delta));
  }
  if (
    (p.type === 'response.output_item.added' || p.type === 'response.output_item.done') &&
    isRec(p.item) &&
    p.item.type === 'function_call'
  ) {
    b.call(`responses:${str(p.item.id) ?? String(p.output_index ?? 0)}`, {
      id: str(p.item.call_id) ?? str(p.item.id),
      name: p.type === 'response.output_item.added' ? str(p.item.name) : undefined,
      args: str(p.item.arguments) || undefined,
      replaceArgs: p.type === 'response.output_item.done',
    });
  }
  if (p.type === 'response.function_call_arguments.delta') {
    b.call(`responses:${str(p.item_id) ?? String(p.output_index ?? 0)}`, { args: str(p.delta) });
  }
  // Gemini: every chunk is a complete candidate fragment.
  if (Array.isArray(p.candidates)) {
    const candidate = p.candidates.find(isRec);
    if (candidate) geminiParts(b, candidate.content, `gemini:${eventIndex}`);
  }
}

function jsonBody(b: PartBuilder, body: Rec, meta: Rec): void {
  captureMeta(meta, body);
  if (Array.isArray(body.choices)) {
    const choice = body.choices.find(isRec);
    const msg = choice && isRec(choice.message) ? choice.message : undefined;
    if (msg) {
      b.text('thinking', str(msg.reasoning_content) ?? str(msg.reasoning));
      b.text('text', str(msg.content));
      b.text('refusal', str(msg.refusal));
      if (Array.isArray(msg.tool_calls)) {
        msg.tool_calls.filter(isRec).forEach((call, i) => {
          const fn = isRec(call.function) ? call.function : {};
          b.call(`chat:${i}`, {
            id: str(call.id),
            name: str(fn.name),
            args: argsText(fn.arguments),
          });
        });
      }
    }
  }
  if (body.type === 'message' && Array.isArray(body.content)) {
    body.content.filter(isRec).forEach((block, i) => {
      if (block.type === 'thinking') b.text('thinking', str(block.thinking));
      if (block.type === 'redacted_thinking') b.text('thinking', '[redacted thinking]');
      if (block.type === 'text') b.text('text', str(block.text));
      if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        b.call(`anthropic:${i}`, {
          id: str(block.id),
          name: str(block.name),
          args: argsText(block.input),
        });
      }
    });
  }
  if (Array.isArray(body.output)) {
    body.output.filter(isRec).forEach((item, i) => {
      if (item.type === 'reasoning') {
        for (const s of Array.isArray(item.summary) ? item.summary.filter(isRec) : []) {
          b.text('thinking', str(s.text));
        }
        for (const c of Array.isArray(item.content) ? item.content.filter(isRec) : []) {
          b.text('thinking', str(c.text));
        }
      }
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content.filter(isRec)) {
          if (c.type === 'refusal') b.text('refusal', str(c.refusal));
          else b.text('text', str(c.text));
        }
      }
      if (item.type === 'function_call') {
        b.call(`responses:${i}`, {
          id: str(item.call_id) ?? str(item.id),
          name: str(item.name),
          args: argsText(item.arguments),
        });
      }
    });
  }
  if (Array.isArray(body.candidates)) {
    const candidate = body.candidates.find(isRec);
    if (candidate) geminiParts(b, candidate.content, 'gemini');
  }
}

export function parseResponse(response: AttemptRecording['response_body']): ParsedResponse {
  const builder = new PartBuilder();
  const meta: Rec = {};
  if (!response) return { mode: 'none', parts: [], events: [], meta };
  if (response.type === 'stream') {
    const events = parseSseEvents(response.raw_sse ?? '');
    for (const event of events) {
      if (isRec(event.data)) streamPayload(builder, event.data, meta, event.index);
    }
    return { mode: 'stream', parts: builder.parts, events, meta };
  }
  if (isRec(response.body)) jsonBody(builder, response.body, meta);
  else if (typeof response.body === 'string') builder.text('text', response.body);
  return { mode: 'json', parts: builder.parts, events: [], meta };
}
