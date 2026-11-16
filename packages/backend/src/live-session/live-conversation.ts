import { createHash } from 'node:crypto';
import type { LiveConversationMessage, LiveWireFormat } from 'thinker-shared';
import { redactInlineImageDataUrls } from '../routing/proxy/inline-image-redaction';

/**
 * Conversation reconstruction for the live session window. Every harness
 * request carries the whole history; normalizing it into neutral messages and
 * comparing them by hash with what the session already showed tells which
 * messages are new (`message.appended`) or whether the harness rewrote its
 * history (`conversation.reset`). Assistant turns only confirm the prefix:
 * their content already reached the window through the attempt's blocks.
 */
export interface NormalizedMessage {
  role: 'system' | 'user' | 'tool' | 'assistant';
  text: string;
  name?: string;
  toolCallId?: string;
  isError?: boolean;
}

export interface NormalizedConversation {
  messages: NormalizedMessage[];
  /** The body carries only new items (Responses `previous_response_id`). */
  delta: boolean;
}

export type ConversationDiff =
  | { kind: 'append'; messages: LiveConversationMessage[] }
  | { kind: 'reset'; messages: LiveConversationMessage[] }
  | { kind: 'none' };

/** Longest text kept per message; the rest is cut with a marker. */
export const MAX_MESSAGE_TEXT = 64 * 1024;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// Claude Code prefixes its system prompt with a per-request billing line.
const BILLING_LINE_RE = /^x-anthropic-billing-header:[^\n]*\n?/gm;

function clip(text: string): string {
  const clean = redactInlineImageDataUrls(text);
  if (clean.length <= MAX_MESSAGE_TEXT) return clean;
  return `${clean.slice(0, MAX_MESSAGE_TEXT)}\n…[${clean.length - MAX_MESSAGE_TEXT} more characters]`;
}

/** Marker for an inline image, reusing the recording redaction wording. */
function imageMarker(value: unknown): string {
  const redacted = redactInlineImageDataUrls(value);
  if (isRec(redacted)) {
    const source = isRec(redacted.source) ? redacted.source : redacted;
    const inline = isRec(source.inline_data)
      ? source.inline_data
      : isRec(source.inlineData)
        ? source.inlineData
        : source;
    const data = str(inline.data);
    if (data?.startsWith('[inline image')) return data;
    const url =
      str(source.url) ??
      (isRec(redacted.image_url) ? str(redacted.image_url.url) : str(redacted.image_url));
    if (url) return url.startsWith('[inline image') ? url : '[image]';
  }
  if (typeof redacted === 'string' && redacted.startsWith('[inline image')) return redacted;
  return '[image]';
}

function stableJson(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return JSON.stringify(value ?? {});
}

function toolUseSummary(name: unknown, id: unknown, args: unknown): string {
  return `[tool_use ${str(name) ?? ''} ${str(id) ?? ''}] ${stableJson(args)}`;
}

// ---------------------------------------------------------------- Anthropic

function anthropicText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') out.push(block);
    else if (!isRec(block)) continue;
    else if (block.type === 'text') out.push(str(block.text) ?? '');
    else if (block.type === 'image') out.push(imageMarker(block));
    else if (block.type === 'document') out.push('[document]');
    else if (block.type === 'search_result') out.push(str(block.title) ?? '[search result]');
  }
  return out.join('\n');
}

function normalizeAnthropic(body: Rec): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  const system = anthropicText(body.system).replace(BILLING_LINE_RE, '').trim();
  if (system.trim()) out.push({ role: 'system', text: system });
  const toolNames = new Map<string, string>();
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    if (!isRec(m)) continue;
    const blocks = Array.isArray(m.content) ? m.content : null;
    if (m.role === 'assistant') {
      const parts: string[] = [];
      if (typeof m.content === 'string') parts.push(m.content);
      for (const b of blocks ?? []) {
        if (!isRec(b)) continue;
        if (b.type === 'text') parts.push(str(b.text) ?? '');
        else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
          if (typeof b.id === 'string' && typeof b.name === 'string') toolNames.set(b.id, b.name);
          parts.push(toolUseSummary(b.name, b.id, b.input));
        }
      }
      out.push({ role: 'assistant', text: parts.join('\n') });
      continue;
    }
    // A user turn: tool results first (they answer the previous turn), then
    // whatever the user wrote.
    const rest: unknown[] = [];
    for (const b of blocks ?? []) {
      if (isRec(b) && b.type === 'tool_result') {
        const id = str(b.tool_use_id);
        out.push({
          role: 'tool',
          text: anthropicText(b.content),
          ...(id ? { toolCallId: id } : {}),
          ...(id && toolNames.has(id) ? { name: toolNames.get(id) } : {}),
          ...(b.is_error === true ? { isError: true } : {}),
        });
      } else {
        rest.push(b);
      }
    }
    const text = blocks ? anthropicText(rest) : anthropicText(m.content);
    if (text.trim() || (!blocks && typeof m.content === 'string')) {
      out.push({ role: 'user', text });
    }
  }
  return out;
}

// ------------------------------------------------------- OpenAI Chat / Resp.

function openAiPartsText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out: string[] = [];
  for (const p of content) {
    if (typeof p === 'string') out.push(p);
    else if (!isRec(p)) continue;
    else if (typeof p.text === 'string') out.push(p.text);
    else if (p.type === 'image_url' || p.type === 'input_image') out.push(imageMarker(p));
    else if (p.type === 'input_audio') out.push('[audio]');
    else if (p.type === 'file' || p.type === 'input_file') out.push('[file]');
    else if (typeof p.refusal === 'string') out.push(p.refusal);
  }
  return out.join('\n');
}

function normalizeChat(body: Rec): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    if (!isRec(m)) continue;
    const role = str(m.role);
    if (role === 'system' || role === 'developer') {
      const text = openAiPartsText(m.content);
      if (text.trim()) out.push({ role: 'system', text });
    } else if (role === 'user') {
      out.push({ role: 'user', text: openAiPartsText(m.content) });
    } else if (role === 'assistant') {
      const parts = [openAiPartsText(m.content)];
      for (const tc of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
        if (!isRec(tc)) continue;
        const fn = isRec(tc.function) ? tc.function : {};
        if (typeof tc.id === 'string' && typeof fn.name === 'string') toolNames.set(tc.id, fn.name);
        parts.push(toolUseSummary(fn.name, tc.id, fn.arguments));
      }
      out.push({ role: 'assistant', text: parts.filter(Boolean).join('\n') });
    } else if (role === 'tool' || role === 'function') {
      const id = str(m.tool_call_id);
      const name = str(m.name) ?? (id ? toolNames.get(id) : undefined);
      out.push({
        role: 'tool',
        text: openAiPartsText(m.content),
        ...(id ? { toolCallId: id } : {}),
        ...(name ? { name } : {}),
      });
    }
  }
  return out;
}

function normalizeResponses(body: Rec): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  const instructions = str(body.instructions);
  if (instructions?.trim()) out.push({ role: 'system', text: instructions });
  if (typeof body.input === 'string') {
    out.push({ role: 'user', text: body.input });
    return out;
  }
  const toolNames = new Map<string, string>();
  for (const item of Array.isArray(body.input) ? body.input : []) {
    if (!isRec(item)) continue;
    const type = str(item.type) ?? (item.role ? 'message' : undefined);
    if (type === 'message') {
      const text = openAiPartsText(item.content);
      if (item.role === 'system' || item.role === 'developer') {
        if (text.trim()) out.push({ role: 'system', text });
      } else if (item.role === 'assistant') {
        out.push({ role: 'assistant', text });
      } else {
        out.push({ role: 'user', text });
      }
    } else if (type === 'function_call' || type === 'custom_tool_call') {
      const id = str(item.call_id);
      if (id && typeof item.name === 'string') toolNames.set(id, item.name);
      out.push({
        role: 'assistant',
        text: toolUseSummary(item.name, id, item.arguments ?? item.input),
      });
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      const id = str(item.call_id);
      const output = item.output;
      out.push({
        role: 'tool',
        text: typeof output === 'string' ? output : openAiPartsText(output),
        ...(id ? { toolCallId: id } : {}),
        ...(id && toolNames.has(id) ? { name: toolNames.get(id) } : {}),
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------- Gemini

function normalizeGemini(rawBody: Rec): NormalizedMessage[] {
  const body = isRec(rawBody.request) ? rawBody.request : rawBody;
  const out: NormalizedMessage[] = [];
  const sys = isRec(body.systemInstruction)
    ? body.systemInstruction
    : isRec(body.system_instruction)
      ? body.system_instruction
      : null;
  const sysParts = sys && Array.isArray(sys.parts) ? sys.parts : [];
  const system = sysParts.map((p) => (isRec(p) ? (str(p.text) ?? '') : '')).join('\n');
  if (system.trim()) out.push({ role: 'system', text: system });
  for (const c of Array.isArray(body.contents) ? body.contents : []) {
    if (!isRec(c)) continue;
    const parts = Array.isArray(c.parts) ? c.parts : [];
    if (c.role === 'model') {
      const text = parts
        .map((p) => {
          if (!isRec(p) || p.thought === true) return '';
          if (isRec(p.functionCall))
            return toolUseSummary(p.functionCall.name, p.functionCall.id, p.functionCall.args);
          return str(p.text) ?? '';
        })
        .filter(Boolean)
        .join('\n');
      out.push({ role: 'assistant', text });
      continue;
    }
    const rest: string[] = [];
    for (const p of parts) {
      if (!isRec(p)) continue;
      const fr = isRec(p.functionResponse) ? p.functionResponse : null;
      if (fr) {
        const id = str(fr.id);
        const name = str(fr.name);
        out.push({
          role: 'tool',
          text: stableJson(fr.response),
          ...(id ? { toolCallId: id } : {}),
          ...(name ? { name } : {}),
        });
      } else if (typeof p.text === 'string') rest.push(p.text);
      else if (p.inlineData || p.inline_data) rest.push(imageMarker(p));
      else if (p.fileData || p.file_data) rest.push('[file]');
    }
    if (rest.length > 0) out.push({ role: 'user', text: rest.join('\n') });
  }
  return out;
}

/** The harness (or provider) request body as neutral messages. */
export function normalizeConversation(
  body: unknown,
  format: LiveWireFormat | null | undefined,
): NormalizedConversation {
  if (!isRec(body)) return { messages: [], delta: false };
  let messages: NormalizedMessage[];
  switch (format) {
    case 'anthropic_messages':
      messages = normalizeAnthropic(body);
      break;
    case 'openai_chat_completions':
      messages = normalizeChat(body);
      break;
    case 'openai_responses':
      messages = normalizeResponses(body);
      break;
    case 'google_generate_content':
    case 'google_code_assist':
      messages = normalizeGemini(body);
      break;
    default:
      return { messages: [], delta: false };
  }
  return {
    messages: messages.map((m) => ({ ...m, text: clip(m.text) })),
    delta: format === 'openai_responses' && typeof body.previous_response_id === 'string',
  };
}

export function hashMessage(m: NormalizedMessage): string {
  return createHash('sha1')
    .update(
      JSON.stringify([m.role, m.text, m.name ?? null, m.toolCallId ?? null, m.isError === true]),
    )
    .digest('base64');
}

function toLive(m: NormalizedMessage): LiveConversationMessage {
  return {
    role: m.role as LiveConversationMessage['role'],
    text: m.text,
    ...(m.name !== undefined ? { name: m.name } : {}),
    ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {}),
    ...(m.isError ? { isError: true } : {}),
  };
}

function systemKey(messages: NormalizedMessage[], hashes: string[]): string {
  return messages
    .map((m, i) => (m.role === 'system' ? hashes[i] : ''))
    .filter(Boolean)
    .join('|');
}

/**
 * The conversation a session has shown so far, as per-message hashes. One
 * tracker per live session entry.
 */
export class ConversationTracker {
  private known: string[] = [];
  private system = '';
  private started = false;

  /** Number of visible (non-assistant) messages, the next `seq`. */
  visibleCount = 0;

  diff(conversation: NormalizedConversation): ConversationDiff {
    const { messages, delta } = conversation;
    const hashes = messages.map(hashMessage);
    const visible = (list: NormalizedMessage[]) =>
      list.filter((m) => m.role !== 'assistant').map(toLive);

    if (delta) {
      // Only the new items travel (the provider keeps the rest).
      this.known.push(...hashes);
      this.started = true;
      const appended = visible(messages);
      this.visibleCount += appended.length;
      return appended.length > 0 ? { kind: 'append', messages: appended } : { kind: 'none' };
    }

    const system = systemKey(messages, hashes);
    const isPrefix =
      this.known.length <= hashes.length && this.known.every((h, i) => hashes[i] === h);

    if (!this.started) {
      // Joining a session already under way (its history has assistant
      // turns): show the whole conversation at once.
      this.started = true;
      this.known = hashes;
      this.system = system;
      const all = visible(messages);
      this.visibleCount = all.length;
      if (messages.some((m) => m.role === 'assistant')) return { kind: 'reset', messages: all };
      return all.length > 0 ? { kind: 'append', messages: all } : { kind: 'none' };
    }

    if (isPrefix) {
      const appended = visible(messages.slice(this.known.length));
      this.known = hashes;
      this.visibleCount += appended.length;
      return appended.length > 0 ? { kind: 'append', messages: appended } : { kind: 'none' };
    }

    // A shorter history under another system prompt is a side request the
    // harness makes in the same session (title, summary, quota check), not a
    // rewrite of the conversation.
    if (system !== this.system && hashes.length < this.known.length) return { kind: 'none' };

    this.known = hashes;
    this.system = system;
    const all = visible(messages);
    this.visibleCount = all.length;
    return { kind: 'reset', messages: all };
  }
}
