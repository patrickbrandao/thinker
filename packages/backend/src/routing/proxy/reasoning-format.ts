/**
 * Client-facing reasoning stream metadata for OpenAI-compatible chunks.
 *
 * This is intentionally separate from request-parameter MPS metadata:
 * providers may use one field to enable reasoning and another field to stream
 * the resulting trace.
 */

export interface OpenAiReasoningStreamFormat {
  outputStreamDeltaPaths: readonly string[];
  clientStreamDeltaPath: 'reasoning_content';
  /**
   * The provider sends reasoning as `thinking` chunks inside a list-shaped
   * `content` (Mistral). They are lifted into `reasoning_content` and the
   * text chunks joined back into a string.
   */
  contentChunks?: boolean;
}

export interface NormalizedReasoningDelta {
  text: string;
  normalized: boolean;
}

const STANDARD_OPENAI_REASONING_STREAM_FORMAT: OpenAiReasoningStreamFormat = Object.freeze({
  outputStreamDeltaPaths: Object.freeze(['reasoning_content']),
  clientStreamDeltaPath: 'reasoning_content',
});

// Cerebras returns the parsed trace in `reasoning` (api-cerebras G1).
const CEREBRAS_REASONING_STREAM_FORMAT: OpenAiReasoningStreamFormat = Object.freeze({
  outputStreamDeltaPaths: Object.freeze(['reasoning_content', 'reasoning']),
  clientStreamDeltaPath: 'reasoning_content',
});

// Mistral returns `content: [{type: 'thinking', ...}, {type: 'text', ...}]` (api-mistral G2).
const MISTRAL_REASONING_STREAM_FORMAT: OpenAiReasoningStreamFormat = Object.freeze({
  outputStreamDeltaPaths: Object.freeze(['reasoning_content']),
  clientStreamDeltaPath: 'reasoning_content',
  contentChunks: true,
});

const COPILOT_REASONING_STREAM_FORMAT: OpenAiReasoningStreamFormat = Object.freeze({
  outputStreamDeltaPaths: Object.freeze(['reasoning_content', 'reasoning_text']),
  clientStreamDeltaPath: 'reasoning_content',
});

/**
 * Endpoints that tolerate `reasoning_content` for at least one model family.
 * Restricting model-family matching to this set prevents false positives on
 * strict OpenAI-compatible hosts that happen to serve a reasoning-derived
 * community slug and would reject the unknown message field.
 */
const REASONING_CONTENT_AWARE_ENDPOINTS = new Set([
  'openrouter',
  'opencode-go',
  'opencode',
  'custom',
]);

const REASONING_MODEL_FAMILY_RE = /^(?:deepseek|kimi|glm|qwen|minimax|mimo)(?:[-_.\d]|$)/i;

/**
 * Families a gateway serves by translating to the vendor's own protocol. The
 * upstream owns the reasoning trace (Anthropic thinking blocks, OpenAI/Gemini
 * reasoning items) and rejects `reasoning_content` as an unknown message field,
 * so they are excluded before any capability check — models.dev marks them
 * `reasoning: true` (they do think), which says nothing about the wire dialect.
 */
const TRANSLATED_DIALECT_FAMILY_RE = /^(?:claude|gpt|o\d|gemini|grok)(?:[-_.\d]|$)/i;

/**
 * Reasoning capability as the model catalog knows it. `undefined` means the
 * catalog has no entry, which hands the decision back to the family fallback.
 */
export interface ReasoningModelCatalog {
  isReasoningModel(endpointKey: string, model: string): boolean | undefined;
}

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Some reasoning APIs reject follow-up turns that don't echo back the previous
 * assistant's `reasoning_content`. Preserve it for:
 *  - the native `deepseek` and `moonshot` endpoints (always)
 *  - aggregator/gateway endpoints (OpenRouter, OpenCode Go, OpenCode and
 *    custom OpenAI-compatible providers) serving a reasoning model over the
 *    DeepSeek dialect.
 * Strict OpenAI-compatible endpoints (Mistral, native OpenAI, etc.) keep
 * stripping the field even if a community fine-tune slug contains "deepseek".
 *
 * On a gateway the slug alone can't answer this — OpenCode serves `big-pickle`
 * (DeepSeek dialect) and `claude-opus-5` (translated) off the same endpoint —
 * so the decision is: never for a translated family, then the catalog's
 * reasoning capability, then the known reasoning families for slugs the
 * catalog has never seen.
 */
export function supportsReasoningContent(
  endpointKey: string,
  model: string,
  catalog?: ReasoningModelCatalog,
): boolean {
  const normalizedEndpoint = endpointKey.toLowerCase();
  const key = normalizedEndpoint.startsWith('custom:') ? 'custom' : normalizedEndpoint;
  if (key === 'deepseek') return true;
  if (key === 'moonshot') return true;
  if (!REASONING_CONTENT_AWARE_ENDPOINTS.has(key)) return false;
  // Bare model id after stripping any vendor/aggregator prefix:
  //   "deepseek/r1"             -> "r1"            -- OpenRouter, not deepseek-family
  //   "openrouter" + "deepseek/deepseek-r1" -> "deepseek-r1"
  //   "opencode-go/kimi-k2.6" -> "kimi-k2.6"
  //   "custom:<uuid>/deepseek-reasoner" -> "deepseek-reasoner"
  // (proxy-fallback.service strips "custom:<uuid>/" before forward, so in
  // practice the custom path passes the already-bare model -- both shapes
  // are handled.)
  const bare = model.toLowerCase().split('/').pop() ?? '';
  if (TRANSLATED_DIALECT_FAMILY_RE.test(bare)) return false;
  const catalogued = catalog?.isReasoningModel(endpointKey, model);
  if (catalogued !== undefined) return catalogued;
  // Kimi speaks the dialect, so an uncatalogued OpenRouter `moonshotai/*` slug
  // is preserved. The catalog outranks this: it is a fallback, not an override.
  if (key === 'openrouter' && model.toLowerCase().startsWith('moonshotai/')) {
    return true;
  }
  // OpenRouter exposes community fine-tunes under vendor prefixes, so an
  // uncatalogued slug only counts when the DeepSeek engine is named outright.
  if (key === 'openrouter') return bare.includes('deepseek');
  return REASONING_MODEL_FAMILY_RE.test(bare);
}

export function getOpenAiReasoningStreamFormat(
  endpointKey: string,
  model: string,
  catalog?: ReasoningModelCatalog,
): OpenAiReasoningStreamFormat | null {
  const normalizedEndpoint = endpointKey.toLowerCase();
  const key = normalizedEndpoint.startsWith('custom:') ? 'custom' : normalizedEndpoint;
  if (key === 'copilot') return COPILOT_REASONING_STREAM_FORMAT;
  if (key === 'cerebras') return CEREBRAS_REASONING_STREAM_FORMAT;
  if (key === 'mistral') return MISTRAL_REASONING_STREAM_FORMAT;
  if (supportsReasoningContent(endpointKey, model, catalog)) {
    return STANDARD_OPENAI_REASONING_STREAM_FORMAT;
  }
  return null;
}

/** Text of a Mistral `thinking` chunk (string or nested text chunks). */
function chunkText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) =>
      part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .join('');
}

/**
 * Split a list-shaped `content` into its text and its thinking. Returns null
 * when `content` is not a chunk list.
 */
function splitContentChunks(content: unknown): { text: string; thinking: string } | null {
  if (!Array.isArray(content)) return null;
  let text = '';
  let thinking = '';
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const chunk = part as Record<string, unknown>;
    if (chunk.type === 'thinking') thinking += chunkText(chunk.thinking ?? chunk.text);
    else if (chunk.type === 'text' && typeof chunk.text === 'string') text += chunk.text;
  }
  return { text, thinking };
}

/**
 * Normalize a non-streaming assistant `message` in place: lift the provider's
 * reasoning field (or Mistral thinking chunks) into `reasoning_content`.
 */
export function normalizeOpenAiReasoningMessage(
  message: Record<string, unknown>,
  format: OpenAiReasoningStreamFormat,
): void {
  if (format.contentChunks) {
    const split = splitContentChunks(message.content);
    if (split) {
      message.content = split.text;
      if (split.thinking && !message.reasoning_content) message.reasoning_content = split.thinking;
    }
  }
  const reasoning = firstStringAtPaths(message, format.outputStreamDeltaPaths);
  if (reasoning && !message.reasoning_content) message.reasoning_content = reasoning;
}

export function normalizeOpenAiReasoningDelta(
  delta: Record<string, unknown>,
  format: OpenAiReasoningStreamFormat,
): NormalizedReasoningDelta | null {
  if (format.contentChunks) {
    const split = splitContentChunks(delta.content);
    if (split) {
      delta.content = split.text;
      if (split.thinking) {
        delta.reasoning_content = split.thinking;
        return { text: split.thinking, normalized: true };
      }
      return { text: '', normalized: true };
    }
  }
  const reasoning = firstStringAtPaths(delta, format.outputStreamDeltaPaths);
  if (!reasoning) return null;

  const existingClientValue = getClientStreamDelta(delta, format.clientStreamDeltaPath);
  if (typeof existingClientValue === 'string' && existingClientValue.length > 0) {
    return { text: reasoning, normalized: false };
  }

  const normalized = setClientStreamDelta(delta, format.clientStreamDeltaPath, reasoning);
  return { text: reasoning, normalized };
}

function firstStringAtPaths(obj: Record<string, unknown>, paths: readonly string[]): string | null {
  for (const path of paths) {
    const value = getPath(obj, path);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = safePathSegments(path);
  if (!segments) return undefined;

  let current: unknown = obj;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function safePathSegments(path: string): string[] | null {
  const segments = path.split('.');
  if (segments.some((segment) => !segment || UNSAFE_PATH_SEGMENTS.has(segment))) return null;
  return segments;
}

function getClientStreamDelta(obj: Record<string, unknown>, path: string): unknown {
  if (path !== 'reasoning_content') return undefined;
  return obj.reasoning_content;
}

function setClientStreamDelta(obj: Record<string, unknown>, path: string, value: string): boolean {
  if (path !== 'reasoning_content') return false;
  obj.reasoning_content = value;
  return true;
}
