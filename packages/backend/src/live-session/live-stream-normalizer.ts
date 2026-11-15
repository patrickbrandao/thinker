import { createParser, type EventSourceParser } from 'eventsource-parser';
import type { LiveBlockType, LiveWireFormat } from 'thinker-shared';

/**
 * Normalizes one provider response (a stream or a JSON body) into the neutral
 * block model of the live session window (docs/dev/janela-sessao-ao-vivo.md):
 * `thinking`, `text` and `tool_use` blocks, numbered 0, 1, 2… in the order
 * they first appear. Signatures, `encrypted_content` and `redacted_thinking`
 * never leave this class: thinking the provider only returns encrypted becomes
 * a `thinking` block with `redacted: true` and no text.
 *
 * Thinking blocks start lazily (on their first non-empty text) so a block the
 * provider never shows can still be announced as redacted when it ends.
 */
export type LiveBlockOp =
  | {
      op: 'start';
      index: number;
      type: LiveBlockType;
      name?: string;
      toolCallId?: string;
      redacted?: boolean;
    }
  | { op: 'delta'; index: number; delta: string }
  | { op: 'stop'; index: number };

interface OpenBlock {
  type: LiveBlockType;
  /** Null while a thinking block has not been announced yet. */
  index: number | null;
  name?: string;
  toolCallId?: string;
  encrypted: boolean;
  textLength: number;
  /** Responses reasoning: summary part being streamed (parts are joined). */
  part?: number;
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const MAX_SSE_BUFFER = 1_048_576;

export class LiveStreamNormalizer {
  /** Provider stop reason (`end_turn`, `tool_use`, `tool_calls`, `STOP`…). */
  stopReason: string | null = null;
  reasoningTokens = 0;
  private nextIndex = 0;
  private readonly open = new Map<string, OpenBlock>();
  private readonly itemKeys = new Map<string, string>();
  private parser: EventSourceParser | null = null;
  private sawToolCall = false;
  private geminiToolCount = 0;
  private responsesStatus: { status?: string; incomplete?: string } | null = null;

  constructor(
    private readonly format: LiveWireFormat | null,
    private readonly emit: (op: LiveBlockOp) => void,
  ) {}

  get blockCount(): number {
    return this.nextIndex;
  }

  /** Raw SSE text from the provider, in any chunking. */
  feedSse(text: string): void {
    if (!text) return;
    if (!this.parser) {
      this.parser = createParser({
        maxBufferSize: MAX_SSE_BUFFER,
        onEvent: (event) => {
          const raw = event.data;
          if (!raw || raw.trim() === '[DONE]') return;
          let data: unknown;
          try {
            data = JSON.parse(raw);
          } catch {
            return;
          }
          this.feedEvent(event.event, data);
        },
        onError: (error) => {
          if (error.type === 'max-buffer-size-exceeded') throw error;
        },
      });
    }
    this.parser.feed(text);
  }

  /** Flushes an SSE event left without its trailing blank line. */
  endSse(): void {
    this.parser?.feed('\n\n');
  }

  /** A whole response body: JSON, or SSE text a non-stream call came back as. */
  feedBody(body: unknown): void {
    if (typeof body === 'string') {
      const trimmed = body.trimStart();
      if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
        this.feedSse(body);
        this.endSse();
        return;
      }
      try {
        body = JSON.parse(body) as unknown;
      } catch {
        return;
      }
    }
    if (Array.isArray(body)) {
      // Gemini streamGenerateContent without SSE answers a JSON array of chunks.
      for (const chunk of body) this.feedEvent(undefined, chunk);
      return;
    }
    if (!isRec(body) || body.error) return;
    switch (this.format) {
      case 'anthropic_messages':
        this.anthropicMessage(body);
        break;
      case 'openai_responses':
        this.responsesObject(isRec(body.response) ? body.response : body);
        break;
      case 'openai_chat_completions':
        this.chatChunk(body, true);
        break;
      case 'google_generate_content':
      case 'google_code_assist':
        this.geminiChunk(body);
        break;
      default:
        break;
    }
  }

  /** One parsed provider stream event. */
  feedEvent(eventName: string | undefined, data: unknown): void {
    if (!isRec(data)) return;
    switch (this.format) {
      case 'anthropic_messages':
        this.anthropicEvent(str(data.type) ?? eventName ?? '', data);
        break;
      case 'openai_responses':
        // Responses streams name the event in `data.type`; some upstreams
        // send no `event:` line at all.
        this.responsesEvent(str(data.type) ?? eventName ?? '', data);
        break;
      case 'openai_chat_completions':
        this.chatChunk(data, false);
        break;
      case 'google_generate_content':
      case 'google_code_assist':
        this.geminiChunk(data);
        break;
      default:
        break;
    }
  }

  /**
   * Ends every open block (a completed response). Open thinking that never
   * showed text is announced as redacted.
   */
  finish(): void {
    for (const key of [...this.open.keys()]) this.end(key);
    if (this.format === 'openai_responses' && this.responsesStatus && !this.stopReason) {
      const { status, incomplete } = this.responsesStatus;
      this.stopReason =
        status === 'incomplete'
          ? (incomplete ?? 'incomplete')
          : this.sawToolCall
            ? 'tool_calls'
            : 'stop';
    }
  }

  // ------------------------------------------------------------- primitives

  private begin(
    key: string,
    type: LiveBlockType,
    extra: { name?: string; toolCallId?: string } = {},
  ): OpenBlock {
    const existing = this.open.get(key);
    if (existing) return existing;
    const block: OpenBlock = { type, index: null, encrypted: false, textLength: 0, ...extra };
    this.open.set(key, block);
    if (type === 'tool_use') this.sawToolCall = true;
    if (type !== 'thinking') this.announce(block, false);
    return block;
  }

  private announce(block: OpenBlock, redacted: boolean): void {
    block.index = this.nextIndex++;
    this.emit({
      op: 'start',
      index: block.index,
      type: block.type,
      ...(block.name !== undefined ? { name: block.name } : {}),
      ...(block.toolCallId !== undefined ? { toolCallId: block.toolCallId } : {}),
      ...(redacted ? { redacted: true } : {}),
    });
  }

  private text(key: string, delta: unknown): void {
    if (typeof delta !== 'string' || delta.length === 0) return;
    const block = this.open.get(key);
    if (!block) return;
    if (block.index === null) this.announce(block, false);
    block.textLength += delta.length;
    this.emit({ op: 'delta', index: block.index!, delta });
  }

  private markEncrypted(key: string): void {
    const block = this.open.get(key);
    if (block) block.encrypted = true;
  }

  private end(key: string): void {
    const block = this.open.get(key);
    if (!block) return;
    this.open.delete(key);
    if (block.index === null) {
      // Thinking that never showed any text: the provider kept it encrypted.
      this.announce(block, true);
    }
    this.emit({ op: 'stop', index: block.index! });
  }

  /** Sequential formats: a new thinking/text block ends the previous one(s). */
  private beginSequential(key: string, type: 'thinking' | 'text'): void {
    if (this.open.has(key)) return;
    for (const [k, b] of [...this.open]) if (b.type !== 'tool_use' && k !== key) this.end(k);
    this.begin(key, type);
  }

  private endNonTool(): void {
    for (const [k, b] of [...this.open]) if (b.type !== 'tool_use') this.end(k);
  }

  // ------------------------------------------------------- Anthropic Messages

  private anthropicEvent(type: string, d: Rec): void {
    const key = `a${num(d.index) ?? 0}`;
    if (type === 'content_block_start') {
      const cb = isRec(d.content_block) ? d.content_block : {};
      this.anthropicBlockStart(key, cb);
    } else if (type === 'content_block_delta') {
      const delta = isRec(d.delta) ? d.delta : {};
      switch (delta.type) {
        case 'thinking_delta':
          this.text(key, delta.thinking);
          break;
        case 'text_delta':
          this.text(key, delta.text);
          break;
        case 'input_json_delta':
          this.text(key, delta.partial_json);
          break;
        case 'signature_delta':
          this.markEncrypted(key);
          break;
        default:
          break;
      }
    } else if (type === 'content_block_stop') {
      this.end(key);
    } else if (type === 'message_delta') {
      const delta = isRec(d.delta) ? d.delta : {};
      if (typeof delta.stop_reason === 'string') this.stopReason = delta.stop_reason;
    }
  }

  private anthropicBlockStart(key: string, cb: Rec): void {
    switch (cb.type) {
      case 'thinking':
        this.begin(key, 'thinking');
        this.text(key, cb.thinking);
        if (cb.signature) this.markEncrypted(key);
        break;
      case 'redacted_thinking':
        this.begin(key, 'thinking');
        this.markEncrypted(key);
        break;
      case 'text':
        this.begin(key, 'text');
        this.text(key, cb.text);
        break;
      case 'tool_use':
      case 'server_tool_use':
        this.begin(key, 'tool_use', { name: str(cb.name), toolCallId: str(cb.id) });
        if (isRec(cb.input) && Object.keys(cb.input).length > 0) {
          this.text(key, JSON.stringify(cb.input));
        }
        break;
      default:
        break;
    }
  }

  private anthropicMessage(body: Rec): void {
    const content = Array.isArray(body.content) ? body.content : [];
    content.forEach((block, i) => {
      if (!isRec(block)) return;
      const key = `a${i}`;
      this.anthropicBlockStart(key, block);
      this.end(key);
    });
    if (typeof body.stop_reason === 'string') this.stopReason = body.stop_reason;
  }

  // --------------------------------------------------------- OpenAI Responses

  private responsesKey(d: Rec): string | undefined {
    const index = num(d.output_index);
    if (index !== undefined) return `r${index}`;
    const itemId = str(d.item_id);
    return itemId ? this.itemKeys.get(itemId) : undefined;
  }

  private responsesItemStart(key: string, item: Rec): void {
    if (typeof item.id === 'string') this.itemKeys.set(item.id, key);
    switch (item.type) {
      case 'reasoning':
        this.begin(key, 'thinking');
        if (item.encrypted_content) this.markEncrypted(key);
        break;
      case 'message':
        this.begin(key, 'text');
        break;
      case 'function_call':
      case 'custom_tool_call':
        this.begin(key, 'tool_use', {
          name: str(item.name),
          toolCallId: str(item.call_id) ?? str(item.id),
        });
        break;
      default:
        break;
    }
  }

  /** Content an item carries whole (an `output_item.done` or a JSON body). */
  private responsesItemContent(key: string, item: Rec): void {
    const block = this.open.get(key);
    if (!block || block.textLength > 0) return;
    if (item.type === 'reasoning') {
      const parts = Array.isArray(item.summary) ? item.summary : [];
      const text = parts
        .map((p) => (isRec(p) ? str(p.text) : undefined))
        .filter((t): t is string => !!t)
        .join('\n\n');
      this.text(key, text);
    } else if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : [];
      for (const p of parts) {
        if (isRec(p)) this.text(key, str(p.text) ?? str(p.refusal));
      }
    } else if (item.type === 'function_call') {
      this.text(key, item.arguments);
    } else if (item.type === 'custom_tool_call') {
      this.text(key, item.input);
    }
  }

  private responsesEvent(type: string, d: Rec): void {
    switch (type) {
      case 'response.output_item.added': {
        const item = isRec(d.item) ? d.item : null;
        const key = item
          ? (this.responsesKey(d) ?? `r${str(item.id) ?? this.nextIndex}`)
          : undefined;
        if (item && key) this.responsesItemStart(key, item);
        break;
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        const key = this.responsesKey(d);
        if (!key) break;
        const block = this.open.get(key);
        const part = num(d.summary_index) ?? num(d.content_index) ?? 0;
        if (block && block.part !== undefined && block.part !== part && block.textLength > 0) {
          this.text(key, '\n\n');
        }
        if (block) block.part = part;
        this.text(key, d.delta);
        break;
      }
      case 'response.output_text.delta':
      case 'response.refusal.delta':
      case 'response.function_call_arguments.delta':
      case 'response.custom_tool_call_input.delta': {
        const key = this.responsesKey(d);
        if (key) this.text(key, d.delta);
        break;
      }
      case 'response.output_item.done': {
        const item = isRec(d.item) ? d.item : null;
        const key =
          this.responsesKey(d) ??
          (item && str(item.id) ? this.itemKeys.get(item.id as string) : undefined);
        if (!key) break;
        if (item) {
          if (!this.open.has(key)) this.responsesItemStart(key, item);
          if (item.encrypted_content) this.markEncrypted(key);
          this.responsesItemContent(key, item);
        }
        this.end(key);
        break;
      }
      case 'response.completed':
      case 'response.incomplete':
      case 'response.done': {
        const response = isRec(d.response) ? d.response : null;
        if (response) this.responsesFinal(response);
        break;
      }
      default:
        break;
    }
  }

  private responsesFinal(response: Rec): void {
    const usage = isRec(response.usage) ? response.usage : null;
    const details =
      usage && isRec(usage.output_tokens_details) ? usage.output_tokens_details : null;
    this.reasoningTokens = num(details?.reasoning_tokens) ?? this.reasoningTokens;
    const incomplete = isRec(response.incomplete_details)
      ? str(response.incomplete_details.reason)
      : undefined;
    this.responsesStatus = { status: str(response.status), incomplete };
  }

  private responsesObject(response: Rec): void {
    const output = Array.isArray(response.output) ? response.output : [];
    output.forEach((item, i) => {
      if (!isRec(item)) return;
      const key = `r${i}`;
      this.responsesItemStart(key, item);
      this.responsesItemContent(key, item);
      this.end(key);
    });
    this.responsesFinal(response);
  }

  // ------------------------------------------------- OpenAI Chat Completions

  private chatChunk(d: Rec, whole: boolean): void {
    const usage = isRec(d.usage) ? d.usage : null;
    const details =
      usage && isRec(usage.completion_tokens_details) ? usage.completion_tokens_details : null;
    const reasoning = num(details?.reasoning_tokens);
    if (reasoning !== undefined) this.reasoningTokens = reasoning;

    const choices = Array.isArray(d.choices) ? d.choices : [];
    const choice = (choices.find((c) => isRec(c) && (c.index === 0 || c.index === undefined)) ??
      choices[0]) as Rec | undefined;
    if (!isRec(choice)) return;
    const delta = isRec(whole ? choice.message : choice.delta)
      ? ((whole ? choice.message : choice.delta) as Rec)
      : {};

    const thinking =
      str(delta.reasoning_content) ||
      str(delta.reasoning) ||
      reasoningDetailsText(delta.reasoning_details);
    if (thinking) {
      this.beginSequential('c-think', 'thinking');
      this.text('c-think', thinking);
    } else if (hasEncryptedReasoning(delta.reasoning_details)) {
      this.beginSequential('c-think', 'thinking');
      this.markEncrypted('c-think');
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      this.beginSequential('c-text', 'text');
      this.text('c-text', delta.content);
    } else if (Array.isArray(delta.content)) {
      // Mistral-style content parts: text and thinking pieces.
      for (const part of delta.content) {
        if (!isRec(part)) continue;
        if (part.type === 'thinking') {
          const pieces = Array.isArray(part.thinking) ? part.thinking : [];
          const text = pieces.map((p) => (isRec(p) ? (str(p.text) ?? '') : '')).join('');
          if (text) {
            this.beginSequential('c-think', 'thinking');
            this.text('c-think', text);
          }
        } else if (typeof part.text === 'string' && part.text) {
          this.beginSequential('c-text', 'text');
          this.text('c-text', part.text);
        }
      }
    }

    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    toolCalls.forEach((tc, i) => {
      if (!isRec(tc)) return;
      const key = `c-tool-${num(tc.index) ?? i}`;
      const fn = isRec(tc.function) ? tc.function : {};
      if (!this.open.has(key)) {
        this.endNonTool();
        this.begin(key, 'tool_use', { name: str(fn.name), toolCallId: str(tc.id) });
      }
      this.text(key, fn.arguments);
    });

    const finish = str(choice.finish_reason);
    if (finish) {
      this.stopReason = finish;
      this.finish();
    } else if (whole) {
      this.finish();
    }
  }

  // ------------------------------------------------------------------ Gemini

  private geminiChunk(raw: Rec): void {
    const d = isRec(raw.response) ? raw.response : raw;
    const usage = isRec(d.usageMetadata) ? d.usageMetadata : null;
    const thoughts = num(usage?.thoughtsTokenCount);
    if (thoughts !== undefined) this.reasoningTokens = thoughts;
    const candidates = Array.isArray(d.candidates) ? d.candidates : [];
    const candidate = candidates[0];
    if (!isRec(candidate)) return;
    const content = isRec(candidate.content) ? candidate.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRec(part)) continue;
      if (isRec(part.functionCall)) {
        const fc = part.functionCall;
        this.endNonTool();
        const key = `g-tool-${this.geminiToolCount++}`;
        this.begin(key, 'tool_use', { name: str(fc.name), toolCallId: str(fc.id) });
        this.text(key, JSON.stringify(isRec(fc.args) ? fc.args : {}));
        this.end(key);
      } else if (typeof part.text === 'string') {
        if (part.thought === true) {
          this.beginSequential('g-think', 'thinking');
          this.text('g-think', part.text);
        } else if (part.text) {
          this.beginSequential('g-text', 'text');
          this.text('g-text', part.text);
        }
      }
    }
    const finish = str(candidate.finishReason);
    if (finish) {
      this.stopReason = this.sawToolCall ? 'tool_calls' : finish;
      this.finish();
    }
  }
}

function reasoningDetailsText(details: unknown): string {
  if (!Array.isArray(details)) return '';
  return details
    .map((d) => {
      if (!isRec(d)) return '';
      if (d.type === 'reasoning.text') return str(d.text) ?? '';
      if (d.type === 'reasoning.summary') return str(d.summary) ?? '';
      return '';
    })
    .join('');
}

function hasEncryptedReasoning(details: unknown): boolean {
  return (
    Array.isArray(details) && details.some((d) => isRec(d) && d.type === 'reasoning.encrypted')
  );
}
