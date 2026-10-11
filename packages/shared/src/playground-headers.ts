/**
 * Request headers a Playground user may NOT attach to the outgoing provider
 * request. The backend enforces this list (`sanitizeRequestHeaders`); the
 * dashboard uses the same list to warn while the user types.
 *
 * Names are compared after trimming and lower-casing.
 */
export const PLAYGROUND_BLOCKED_HEADERS: readonly string[] = [
  // Credentials. Every header a provider adapter authenticates with, plus the
  // common gateway ones, so a user can't override or duplicate the stored key.
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-goog-api-key',
  'x-goog-iam-authorization-token',
  'ocp-apim-subscription-key',
  'cookie',
  'set-cookie',
  // Tenant / billing identity. These pick which account, org, project or
  // workspace the stored credential acts on and bills.
  'openai-organization',
  'openai-project',
  'chatgpt-account-id',
  'x-goog-user-project',
  'x-goog-iam-authority-selector',
  // Codex session affinity, set by the gateway for ChatGPT subscriptions.
  // `x-codex-turn-state` is an opaque token the upstream issued to the account.
  'session-id',
  'thread-id',
  'x-codex-turn-state',
  // Transport, hop-by-hop and host-controlling headers.
  'host',
  'content-length',
  'content-type',
  'content-encoding',
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'forwarded',
  'x-real-ip',
];

/**
 * Prefixes blocked as a whole: the gateway's own namespaces, AWS signing and
 * operation headers (`x-amz-target` picks the operation Kiro runs with the
 * stored token), and proxy-forwarding headers.
 */
export const PLAYGROUND_BLOCKED_HEADER_PREFIXES: readonly string[] = [
  'x-thinker-',
  'x-manifest-',
  'x-amz-',
  'x-amzn-',
  'x-forwarded-',
];

const BLOCKED_SET: ReadonlySet<string> = new Set(PLAYGROUND_BLOCKED_HEADERS);

/** True when a Playground extra header must not reach the provider. */
export function isPlaygroundHeaderBlocked(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (!lower) return false;
  if (BLOCKED_SET.has(lower)) return true;
  return PLAYGROUND_BLOCKED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
