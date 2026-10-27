import type { ModelRoute } from 'thinker-shared';

/** Rough characters per token for the request estimate (#134). */
const CHARS_PER_TOKEN = 4;

/**
 * A route is skipped only when the estimate exceeds this share of its context
 * window, so a heuristic that undercounts (code, CJK) still catches requests
 * that sit right at the limit.
 */
export const CONTEXT_FIT_RATIO = 0.95;

/** Body fields that carry prompt text in the chat, Messages and Responses formats. */
const PROMPT_FIELDS = ['messages', 'system', 'input', 'instructions', 'prompt'] as const;

/** Object keys whose string values are binary payloads (images, files), not prompt text. */
const BINARY_KEYS = new Set(['data', 'b64_json', 'file_data', 'image_url', 'url']);

function promptChars(value: unknown, key: string | undefined, depth: number): number {
  if (depth > 32) return 0;
  if (typeof value === 'string') {
    if ((key && BINARY_KEYS.has(key)) || value.startsWith('data:')) return 0;
    return value.length;
  }
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) total += promptChars(item, undefined, depth + 1);
    return total;
  }
  if (value && typeof value === 'object') {
    let total = 0;
    for (const [k, v] of Object.entries(value)) total += promptChars(v, k, depth + 1);
    return total;
  }
  return 0;
}

function requestedOutputTokens(body: Record<string, unknown>): number {
  for (const field of ['max_completion_tokens', 'max_tokens', 'max_output_tokens']) {
    const value = body[field];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/**
 * Cheap token estimate of a proxy request: the text of the prompt fields
 * (inline images and files left out) plus the tool definitions, at about four
 * characters per token, plus the output budget the client asked for, since
 * providers reject a request whose input and max tokens overflow the window.
 */
export function estimateRequestTokens(body: Record<string, unknown>): number {
  let chars = 0;
  for (const field of PROMPT_FIELDS) chars += promptChars(body[field], field, 0);
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    try {
      chars += JSON.stringify(body.tools).length;
    } catch {
      // A body that came off the wire is always serializable; ignore otherwise.
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + requestedOutputTokens(body);
}

/**
 * Smallest context window worth checking. A request at or under this share of
 * it fits every model, so the proxy skips the catalog lookup entirely.
 */
const MIN_CHECKED_CONTEXT_WINDOW = 4096;

/** Whether an estimate is large enough that some route might not take it. */
export function mayExceedContextWindows(estimatedTokens: number): boolean {
  return estimatedTokens > CONTEXT_FIT_RATIO * MIN_CHECKED_CONTEXT_WINDOW;
}

/** Whether an estimate clearly overflows a context window. Unknown window: never. */
export function exceedsContextWindow(
  estimatedTokens: number,
  contextWindow: number | null | undefined,
): boolean {
  if (contextWindow == null || !Number.isFinite(contextWindow) || contextWindow <= 0) return false;
  return estimatedTokens > CONTEXT_FIT_RATIO * contextWindow;
}

export interface ContextFitPlan {
  /** The chain to walk: the routes that may fit, in their original order. */
  routes: ModelRoute[];
  /** Routes left out because their known window cannot take the request. */
  skipped: ModelRoute[];
}

/**
 * Drops the routes of a chain (primary first, then fallbacks) whose known
 * context window the request clearly overflows. A route with an unknown
 * window is kept. When no route would be left, the chain is returned
 * unchanged, so a request nothing can take behaves as it did before.
 */
export function planContextFit(
  chain: readonly ModelRoute[],
  estimatedTokens: number,
  windowOf: (route: ModelRoute) => number | null,
): ContextFitPlan {
  const routes: ModelRoute[] = [];
  const skipped: ModelRoute[] = [];
  for (const route of chain) {
    if (exceedsContextWindow(estimatedTokens, windowOf(route))) skipped.push(route);
    else routes.push(route);
  }
  if (routes.length === 0) return { routes: [...chain], skipped: [] };
  return { routes, skipped };
}
