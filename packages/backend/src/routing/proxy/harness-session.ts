/**
 * Harness session detection. Each harness names its session in a header of
 * its own; the first non-empty one in this order wins.
 *
 * - `x-session-key`: Thinker's own convention (OpenClaw plugin, SDK apps).
 * - `x-openclaw-session-key`: OpenClaw gateway.
 * - `x-claude-code-session-id`: Claude Code (2.1.86+), on every request.
 *   Subagents (Task tool, agent teams) keep the main session id and add
 *   `x-claude-code-agent-id` (2.1.139+): they become `<session>:<agent>`
 *   children of the main session, nested agents included.
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
  const claudeAgent = pick(headers, ['x-claude-code-agent-id']);
  if (claudeAgent && pick(headers, ['x-claude-code-session-id']) === id) {
    return { id: `${id}:${claudeAgent}`.slice(0, MAX_ID_LENGTH), parentId: id };
  }
  const parentId = pick(headers, PARENT_HEADERS);
  return { id, parentId: parentId && parentId !== id ? parentId : null };
}

/**
 * Top-level body fields some harnesses add for their own gateway and no
 * provider accepts. DeepSeek Harness sends `dsh_session_log` (up to 8 MiB of
 * session transcript) and `dsh_plugin_packages`; Anthropic answers 400 to
 * unknown fields, and the log must not reach a third party or our request
 * log (harness-deepseek-harness G2).
 */
const HARNESS_PRIVATE_FIELD_PREFIXES = ['dsh_'] as const;

/** Remove harness-private top-level fields from a request body, in place. */
export function stripHarnessPrivateFields(body: Record<string, unknown> | null | undefined): void {
  if (!body || typeof body !== 'object') return;
  for (const key of Object.keys(body)) {
    if (HARNESS_PRIVATE_FIELD_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete body[key];
    }
  }
}
