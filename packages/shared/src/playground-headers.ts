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
  // Response negotiation. The gateway reads usage out of the response body, so
  // it must get the shape it parses: SSE or JSON, and an encoding fetch can
  // decode (gzip, deflate, br, zstd). An `accept` asking for something else, or
  // an `accept-encoding` naming an encoding fetch passes through raw, would
  // record 0 tokens for a run the provider still bills.
  'accept',
  'accept-encoding',
];

/**
 * Prefixes blocked as a whole: the gateway's own namespaces, AWS signing and
 * operation headers (`x-amz-target` picks the operation Kiro runs with the
 * stored token), and proxy-forwarding headers.
 */
export const PLAYGROUND_BLOCKED_HEADER_PREFIXES: readonly string[] = [
  'x-thinker-',
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

/** RFC 9110 `token`. Anything else is not a valid header name and makes fetch throw. */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * A header value fetch can send: horizontal tab, printable ASCII and
 * U+0080-U+00FF. fetch throws on every other C0 control (CR, LF and NUL
 * included, which would also allow header injection) and DEL (undici
 * `UND_ERR_INVALID_ARG`), and on any code point above U+00FF (not a
 * ByteString). C1 controls (U+0080-U+009F) are valid `obs-text` and fetch sends
 * them, so they are accepted here too.
 */
const INVALID_VALUE_CHAR_RE = /[^\t\x20-\x7e\x80-\xff]/;

/**
 * True when `name`, after trimming, is a valid HTTP header name (an RFC 9110
 * token). Run it before `isPlaygroundHeaderBlocked`: the ASCII-only check
 * rejects names such as `x-api-Key` (Kelvin sign) that lower-case to a
 * blocked name.
 */
export function isPlaygroundHeaderNameValid(name: string): boolean {
  return HEADER_NAME_RE.test(name.trim());
}

/** True when fetch accepts `value` as a header value, so the run cannot fail on it. */
export function isPlaygroundHeaderValueValid(value: string): boolean {
  return !INVALID_VALUE_CHAR_RE.test(value);
}
