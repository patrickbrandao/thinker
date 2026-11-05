/**
 * OpenAI chat-style models that only accept /v1/responses (not /v1/chat/completions).
 * The proxy swaps the endpoint at forward time; discovery keeps these so users can
 * select them. Covers: Codex (except codex-mini-latest), GPT-5+ -pro variants,
 * o1-pro, and deep-research models.
 *
 * Shared by model discovery and the routing proxy — kept in `common/constants`
 * so neither module imports from the other just for this pattern.
 */
export const OPENAI_RESPONSES_ONLY_RE =
  /(?:-codex(?!-mini-latest)|^gpt-5[^/]*-pro(?:-|$)|^o1-pro|^o\d(?:-mini)?-deep-research(?:-|$))/i;

/** GPT-6 models that call tools only through /v1/responses. */
const OPENAI_TOOLS_RESPONSES_ONLY_RE =
  /^gpt-6(?:\.1)?-(?:astra|terra)(?:-|$)|^gpt-6\.1-sol(?:-|$)/i;
/** GPT-6 models that call tools on Chat Completions only with effort `none`. */
const OPENAI_TOOLS_NEED_NO_REASONING_RE = /^gpt-6-(?:sol|luna)(?:-|$)/i;

/**
 * Whether a Chat Completions request must go to /v1/responses because it
 * carries function tools the model only runs there (api-openai G1).
 */
export function openAiToolsNeedResponses(
  model: string,
  body: Record<string, unknown> | undefined,
): boolean {
  if (!body || !Array.isArray(body.tools) || body.tools.length === 0) return false;
  if (OPENAI_TOOLS_RESPONSES_ONLY_RE.test(model)) return true;
  return OPENAI_TOOLS_NEED_NO_REASONING_RE.test(model) && body.reasoning_effort !== 'none';
}

/** Strip a single leading vendor prefix ("openai/foo" → "foo"). No-op if none. */
export function stripVendorPrefix(model: string): string {
  const slashIdx = model.indexOf('/');
  return slashIdx > 0 ? model.substring(slashIdx + 1) : model;
}
