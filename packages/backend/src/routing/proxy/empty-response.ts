/**
 * Empty-success qualifier (#129, upstream mnfst/llm-gateway#2781): some
 * providers (OpenRouter free models, notably) answer HTTP 200 with zero input
 * and zero output tokens and no content at all. Passing that through counts as
 * a success and skips the fallback chain. A non-streaming 200 whose body has
 * BOTH zero reported tokens AND no content is turned into a synthetic 502, so
 * the next route gets its turn. Either signal alone is not enough: a short
 * legitimate reply still reports tokens, and a provider that omits usage is
 * left alone. THINKER_EMPTY_RESPONSE_FALLBACK=false turns the check off.
 */

export const EMPTY_RESPONSE_STATUS = 502;

export function isEmptyResponseFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['THINKER_EMPTY_RESPONSE_FALLBACK']?.trim().toLowerCase();
  return !['false', '0', 'no', 'off'].includes(value ?? '');
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** True only when usage is present and every token count in it is zero. */
function reportsZeroTokens(usage: unknown): boolean {
  if (!isRecord(usage)) return false;
  // OpenAI chat/responses and Anthropic field names.
  const counts = [
    usage['prompt_tokens'],
    usage['completion_tokens'],
    usage['input_tokens'],
    usage['output_tokens'],
    usage['total_tokens'],
  ]
    .map(num)
    .filter((n): n is number => n !== null);
  return counts.length > 0 && counts.every((n) => n === 0);
}

function hasText(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.some(hasContent);
  return false;
}

function hasContent(part: unknown): boolean {
  if (typeof part === 'string') return part.length > 0;
  if (!isRecord(part)) return false;
  // Any non-text block (tool use, image, ...) counts as content.
  if (part['type'] !== undefined && part['type'] !== 'text' && part['type'] !== 'output_text') {
    return true;
  }
  return hasText(part['text']) || hasText(part['content']);
}

function chatChoiceHasContent(choice: unknown): boolean {
  if (!isRecord(choice)) return false;
  const message = isRecord(choice['message']) ? choice['message'] : {};
  const toolCalls = message['tool_calls'];
  return (
    hasText(message['content']) ||
    hasText(message['reasoning']) ||
    hasText(message['reasoning_content']) ||
    hasText(choice['text']) ||
    (Array.isArray(toolCalls) && toolCalls.length > 0) ||
    isRecord(message['function_call'])
  );
}

/** True for a parsed body that reports zero tokens and carries no content. */
export function isEmptySuccessBody(body: unknown): boolean {
  if (!isRecord(body) || !reportsZeroTokens(body['usage'])) return false;
  if (Array.isArray(body['choices'])) return !body['choices'].some(chatChoiceHasContent);
  if (Array.isArray(body['content'])) return !body['content'].some(hasContent);
  if (Array.isArray(body['output'])) return !body['output'].some(hasContent);
  return false;
}

/** Same check on raw bytes; anything that is not JSON is not "empty". */
export function isEmptySuccessPayload(payload: ArrayBuffer): boolean {
  if (payload.byteLength === 0 || payload.byteLength > 64 * 1024) return false;
  try {
    return isEmptySuccessBody(JSON.parse(new TextDecoder().decode(payload)));
  } catch {
    return false;
  }
}

export function buildEmptyResponseError(): Response {
  return new Response(
    JSON.stringify({
      error: { message: 'Provider returned an empty response (no content, zero tokens)' },
    }),
    {
      status: EMPTY_RESPONSE_STATUS,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'application/json' },
    },
  );
}
