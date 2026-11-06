/**
 * Upstream failures disguised as success (report from NOC Norte, P3/P5):
 * an HTTP 200 whose JSON body is only `{"error": ...}`, and a stream whose
 * first event is an error. Both become a real status before anything reaches
 * the client, so fallback, the 429 cooldown and the same-route retry see them
 * like any HTTP error. Also the context-window classifier shared with the
 * error sanitizer.
 */

/** Header stamped on a response rebuilt from an embedded or stream-start error. */
export const EMBEDDED_UPSTREAM_ERROR_HEADER = 'x-thinker-embedded-upstream-error';

/** Bodies larger than this are never parsed for an embedded error. */
export const EMBEDDED_ERROR_MAX_BYTES = 2 * 1024 * 1024;

/** Top-level keys of a real success: their presence means the body is not an error. */
const SUCCESS_BODY_MARKERS = ['choices', 'content', 'candidates', 'output', 'data', 'completion'];

const OFF_RE = /^(0|false|off|no)$/i;

export function isEmbeddedErrorCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !OFF_RE.test((env.THINKER_EMBEDDED_ERROR_CHECK ?? '').trim());
}

/**
 * Context-window overflow wording across providers (NOC Norte corpus: 209 of
 * 209 real messages, no false positive). Only applied to structured error
 * fields, never to a whole body, so an echoed prompt cannot match.
 */
const CONTEXT_ERROR_PATTERNS: readonly RegExp[] = [
  /\bcontext_length_exceeded\b/i,
  /\bexceed(?:s|ed)?_context_size(?:_error)?\b/i,
  /\bcontext_window_exceeded\b/i,
  /\bmaximum context length\b/i,
  /\bcontext (?:length|window|size)\b[^.\n]{0,120}\b(?:exceed|exceeds|exceeded|too (?:long|large|small))\b/i,
  /\b(?:exceed|exceeds|exceeded|exceeding)\b[^.\n]{0,120}\bcontext (?:length|window|size|limit)\b/i,
  /\binput length\b[^.\n]{0,80}\bexceed/i,
  /\bmaximum input length\b/i,
  /\b(?:prompt|input|request) is too (?:long|large)\b/i,
  /\binput too long\b/i,
  /\binput token count\b[^.\n]{0,80}\bexceed/i,
  /\btoo many (?:input |prompt )?tokens\b[^.\n]{0,120}\b(?:exceed|maximum|context)/i,
  /\breduce the length of the (?:messages|prompt|input)\b/i,
];

export function isContextLengthText(text: string | null | undefined): boolean {
  return (
    typeof text === 'string' &&
    text.length > 0 &&
    CONTEXT_ERROR_PATTERNS.some((re) => re.test(text))
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** message, code, type and metadata.raw of an error object (plus the root message). */
function structuredErrorText(error: unknown, root?: Record<string, unknown> | null): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.length > 0) parts.push(v.slice(0, 16_384));
  };
  if (typeof error === 'string') push(error);
  const err = record(error);
  if (err) {
    push(err.message);
    push(err.code);
    push(err.type);
    const metadata = record(err.metadata);
    const raw = metadata?.raw;
    if (typeof raw === 'string') push(raw);
    else if (raw && typeof raw === 'object') push(JSON.stringify(raw));
  }
  if (root && root !== err) push(root.message);
  return parts.join('\n');
}

/** Whether an error body (JSON or text) reports a context-window overflow. */
export function isContextLengthBody(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const obj = record(JSON.parse(trimmed));
      if (obj) return isContextLengthText(structuredErrorText(obj.error ?? obj, obj));
    } catch {
      // not JSON: fall through to the bounded text check
    }
  }
  return isContextLengthText(text.slice(0, 8_192));
}

function numericCode(code: unknown): number | null {
  const n =
    typeof code === 'number'
      ? code
      : typeof code === 'string' && /^\d{3}$/.test(code.trim())
        ? Number(code.trim())
        : Number.NaN;
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : null;
}

/**
 * Status for an error reported inside a 200: its own `code` (or `status`)
 * when it is an HTTP error status; otherwise 400 for a context overflow (so it
 * is never retried on the same route) and 502 for anything else.
 */
export function embeddedErrorStatus(error: unknown, root?: Record<string, unknown> | null): number {
  const err = record(error);
  const own = numericCode(err?.code) ?? numericCode(err?.status) ?? numericCode(root?.status);
  if (own !== null) return own;
  return isContextLengthText(structuredErrorText(error, root)) ? 400 : 502;
}

export interface EmbeddedUpstreamError {
  status: number;
  /** The upstream body, unchanged. */
  body: string;
  contextLength: boolean;
}

/**
 * A buffered 200 JSON body that only carries `error`: none of the success
 * markers. Null for anything else (a real success, a mixed body, non-JSON,
 * an oversized body).
 */
export function embeddedUpstreamError(payload: ArrayBuffer): EmbeddedUpstreamError | null {
  if (payload.byteLength === 0 || payload.byteLength > EMBEDDED_ERROR_MAX_BYTES) return null;
  const text = new TextDecoder().decode(payload);
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return null;
  let obj: Record<string, unknown> | null;
  try {
    obj = record(JSON.parse(trimmed));
  } catch {
    return null;
  }
  if (!obj || obj.error == null) return null;
  if (typeof obj.error !== 'object' && typeof obj.error !== 'string') return null;
  if (SUCCESS_BODY_MARKERS.some((key) => key in obj!)) return null;
  return {
    status: embeddedErrorStatus(obj.error, obj),
    body: text,
    contextLength: isContextLengthText(structuredErrorText(obj.error, obj)),
  };
}

/** Rebuild an upstream error as a real HTTP error response. */
export function embeddedErrorResponse(error: EmbeddedUpstreamError, headers?: Headers): Response {
  const out = new Headers();
  const contentType = headers?.get('content-type');
  out.set(
    'content-type',
    contentType && contentType.includes('json') ? contentType : 'application/json',
  );
  out.set(EMBEDDED_UPSTREAM_ERROR_HEADER, '1');
  return new Response(error.body, { status: error.status, headers: out });
}

/* ── Stream start ── */

function choicesHaveContent(obj: Record<string, unknown>): boolean {
  if (!Array.isArray(obj.choices)) return false;
  for (const raw of obj.choices) {
    const choice = record(raw);
    if (!choice) continue;
    if (choice.finish_reason != null && choice.finish_reason !== 'error') return true;
    const d = record(choice.delta) ?? record(choice.message);
    if (!d) continue;
    if (
      typeof d.content === 'string'
        ? d.content.length > 0
        : Array.isArray(d.content) && d.content.length > 0
    )
      return true;
    for (const k of ['reasoning', 'reasoning_content', 'refusal']) {
      if (typeof d[k] === 'string' && (d[k] as string).length > 0) return true;
    }
    if (
      (Array.isArray(d.reasoning_details) && d.reasoning_details.length > 0) ||
      (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) ||
      d.function_call != null ||
      d.audio != null
    )
      return true;
  }
  return false;
}

/** Lifecycle events that announce a stream but carry nothing the client sees yet. */
const PREAMBLE_EVENT_TYPES = new Set([
  // Anthropic Messages
  'message_start',
  'ping',
  // OpenAI Responses
  'response.created',
  'response.in_progress',
  'response.queued',
]);

export type StreamStartVerdict =
  | { state: 'pending' }
  | { state: 'content' }
  | { state: 'error'; status: number; body: string; contextLength: boolean };

function streamError(error: unknown, root: Record<string, unknown>): StreamStartVerdict {
  const body = JSON.stringify(root.error != null ? root : { error });
  return {
    state: 'error',
    status: embeddedErrorStatus(error, root),
    body,
    contextLength: isContextLengthText(structuredErrorText(error, root)),
  };
}

/**
 * Judge the complete SSE events received so far: `error` for an error event
 * before any content, `content` for the first event with client-visible
 * content (or anything unrecognised: never hold what we do not understand),
 * `pending` while there are only comments, keepalives and preamble events.
 */
export function scanSseStart(text: string): StreamStartVerdict {
  const blocks = text.split(/\r?\n\r?\n/);
  blocks.pop(); // incomplete trailing event
  for (const block of blocks) {
    let eventName: string | null = null;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length === 0) continue;
    const payload = data.join('\n');
    if (payload.trim() === '[DONE]') return { state: 'content' };
    let obj: Record<string, unknown> | null;
    try {
      obj = record(JSON.parse(payload));
    } catch {
      return { state: 'content' };
    }
    if (!obj) return { state: 'content' };
    const type = typeof obj.type === 'string' ? obj.type : eventName;
    if (type === 'response.failed') {
      const response = record(obj.response);
      return streamError(response?.error ?? { message: 'response.failed' }, obj);
    }
    const error = obj.error ?? (eventName === 'error' || type === 'error' ? obj : undefined);
    if (
      error != null &&
      (typeof error === 'object' || typeof error === 'string') &&
      !choicesHaveContent(obj)
    ) {
      return streamError(error, obj);
    }
    if (type && PREAMBLE_EVENT_TYPES.has(type)) continue;
    if (!Array.isArray(obj.choices)) return { state: 'content' };
    if (obj.usage != null || choicesHaveContent(obj)) return { state: 'content' };
    // An OpenAI chunk with an empty delta (role only, or finish_reason "error"
    // alone): keep peeking.
  }
  return { state: 'pending' };
}
