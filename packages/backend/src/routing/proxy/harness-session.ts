/**
 * Harness session detection. Each harness names its session in a header of
 * its own; the first non-empty one in this order wins.
 *
 * - `x-session-key`: Thinker's own convention (OpenClaw plugin, SDK apps).
 * - `x-openclaw-session-key`: OpenClaw gateway.
 * - `x-claude-code-session-id`: Claude Code (2.1.86+), on every request.
 * - `x-opencode-session-id` / `x-opencode-session`: OpenCode; subagent
 *   sessions add `x-opencode-parent-session-id` / `x-parent-session-id`.
 * - `x-hermes-session-id` / `x-hermes-session-key`: Hermes Agent.
 * - `x-deepseek-harness-session-id`: DeepSeek Harness.
 * - `x-openwebui-chat-id`: Open WebUI (with forwarded user info headers).
 * - `session-id` (0.150+) / `session_id` / `conversation_id`: Codex CLI;
 *   subagents add `x-codex-parent-thread-id`. Builds without a session
 *   header send the conversation id as `x-client-request-id`, read only next
 *   to Codex's `originator` header since other SDKs use it per request.
 * - `x-session-id` / `x-session-affinity`: generic fallbacks.
 */
const SESSION_HEADERS = [
  'x-session-key',
  'x-openclaw-session-key',
  'x-claude-code-session-id',
  'x-opencode-session-id',
  'x-opencode-session',
  'x-hermes-session-id',
  'x-hermes-session-key',
  'x-deepseek-harness-session-id',
  'x-openwebui-chat-id',
  'session-id',
  'session_id',
  'conversation_id',
  'x-session-id',
  'x-session-affinity',
] as const;

const PARENT_HEADERS = [
  'x-opencode-parent-session-id',
  'x-parent-session-id',
  'x-codex-parent-thread-id',
] as const;

const MAX_ID_LENGTH = 200;

export interface HarnessSession {
  id: string;
  /** Session that spawned this one (an OpenCode subagent's main session). */
  parentId: string | null;
}

function pick(
  headers: Record<string, string | string[] | undefined>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const raw = headers[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value && value !== 'default' && value !== '[REDACTED]') {
      return value.slice(0, MAX_ID_LENGTH);
    }
  }
  return null;
}

/** The harness session a request belongs to, or null when it names none. */
export function detectHarnessSession(
  headers: Record<string, string | string[] | undefined> | null | undefined,
): HarnessSession | null {
  if (!headers) return null;
  const codex = headers['originator'] ? ['x-client-request-id'] : [];
  const id = pick(headers, [...SESSION_HEADERS, ...codex]);
  if (!id) return null;
  const parentId = pick(headers, PARENT_HEADERS);
  return { id, parentId: parentId && parentId !== id ? parentId : null };
}
