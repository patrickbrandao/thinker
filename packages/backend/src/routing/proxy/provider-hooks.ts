import { createHash, randomBytes } from 'crypto';
import { PROVIDER_BY_ID_OR_ALIAS } from '../../common/constants/providers';

/**
 * Provider-specific hooks — data-driven lookups that replace scattered
 * `if (provider === 'foo')` chains across the proxy layer.
 *
 * When adding a provider that needs a specialised endpoint for subscription
 * auth, or a custom forward-time header, declare it here rather than adding
 * another `if` branch in the proxy code.
 */

/**
 * Maps `(provider-endpoint-key, auth-type)` → endpoint key for subscription
 * flows. Allows a provider to use a different backend endpoint when the
 * authenticated user is on a subscription plan rather than a per-request key.
 */
const SUBSCRIPTION_ENDPOINT_OVERRIDES: Record<string, string> = {
  openai: 'openai-subscription',
  byteplus: 'byteplus-anthropic',
  minimax: 'minimax-subscription',
  xiaomi: 'xiaomi-subscription',
  moonshot: 'moonshot-subscription',
  qwen: 'qwen-subscription',
  zai: 'zai-subscription',
  xai: 'xai-subscription',
  // Gemini's per-API-key endpoint is registered under the legacy key
  // `'google'`, so the override is keyed there too. The OAuth flow shifts
  // to CodeAssist (gemini-subscription).
  google: 'gemini-subscription',
};

export function resolveSubscriptionEndpointKey(endpointKey: string): string | undefined {
  return SUBSCRIPTION_ENDPOINT_OVERRIDES[endpointKey];
}

/**
 * Keys available to an extra-header builder, both already hashed into
 * opaque `thinker-*` identifiers.
 */
interface ExtraHeaderKeys {
  /** Per-conversation key; absent when the caller sent no x-session-key. */
  sessionKey?: string;
  /** Per-agent key; absent when the forward carries no tenant/agent identity. */
  agentKey?: string;
}

// OpenCode Go and OpenCode pin a session to one upstream provider via
// x-opencode-session and reject some models without it, so unlike the
// observability-only hints above the headers must ride on every request:
// fall back to the per-agent key when the caller sent no x-session-key.
// They mirror the OpenCode 2 client (session/model-request.ts): one session
// id in its four session headers, plus a 40-hex project id.
const opencodeSessionHeaders = ({ sessionKey, agentKey }: ExtraHeaderKeys) => {
  const key = sessionKey ?? agentKey;
  if (!key) return undefined;
  const sessionId = opencodeSessionId(key);
  return {
    'x-opencode-session-id': sessionId,
    'x-session-affinity': sessionId,
    'X-Session-Id': sessionId,
    'x-opencode-project': agentKey
      ? createHash('sha1').update(agentKey).digest('hex')
      : OPENCODE_GLOBAL_PROJECT,
    'x-opencode-session': sessionId,
  };
};

const OPENCODE_GLOBAL_PROJECT = 'global';
const OPENCODE_SESSION_IDS_MAX = 10_000;
const opencodeSessionIds = new Map<string, string>();
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * A stable OpenCode session id per conversation key, minted the first time
 * the key is seen the way the client mints one (schema/identifier.ts):
 * `ses_`, 12 hex of the inverted `ms * 0x1000 + counter`, 14 random base62.
 */
export function opencodeSessionId(key: string, now = Date.now()): string {
  const known = opencodeSessionIds.get(key);
  if (known) return known;
  const value = ~(BigInt(now) * 0x1000n + 1n) & 0xffffffffffffn;
  const random = Array.from(randomBytes(14), (byte) => BASE62[byte % 62]).join('');
  const id = `ses_${value.toString(16).padStart(12, '0')}${random}`;
  if (opencodeSessionIds.size >= OPENCODE_SESSION_IDS_MAX) {
    opencodeSessionIds.delete(opencodeSessionIds.keys().next().value!);
  }
  opencodeSessionIds.set(key, id);
  return id;
}

/**
 * Extra HTTP headers that must be attached at forward-time for specific
 * providers (typically for observability on the provider side).
 */
const PROVIDER_EXTRA_HEADER_BUILDERS: Record<
  string,
  (keys: ExtraHeaderKeys) => Record<string, string> | undefined
> = {
  xai: ({ sessionKey }) => (sessionKey ? { 'x-grok-conv-id': sessionKey } : undefined),
  openrouter: ({ sessionKey }) =>
    !sessionKey || sessionKey === 'default' ? undefined : { 'x-session-id': sessionKey },
  'opencode-go': opencodeSessionHeaders,
  opencode: opencodeSessionHeaders,
  // Vibe's session affinity hint (sub-mistral G2).
  mistral: ({ sessionKey }) => (sessionKey ? { 'x-affinity': sessionKey } : undefined),
};

export function buildProviderExtraHeaders(
  provider: string,
  providerCacheKey?: string,
  agentScopeKey?: string,
): Record<string, string> | undefined {
  // Canonicalize through the registry so alias-keyed providers (e.g.
  // `opencodego` → `opencode-go`) hit the same builder as their canonical id.
  const lower = provider.toLowerCase();
  const canonical = PROVIDER_BY_ID_OR_ALIAS.get(lower)?.id ?? lower;
  const builder = PROVIDER_EXTRA_HEADER_BUILDERS[canonical];
  if (!builder) return undefined;
  return builder({
    sessionKey: providerCacheKey ? buildProviderPromptCacheKey(providerCacheKey) : undefined,
    agentKey: agentScopeKey ? buildProviderPromptCacheKey(agentScopeKey) : undefined,
  });
}

function buildProviderPromptCacheKey(providerCacheKey: string): string {
  const digest = createHash('sha256').update(providerCacheKey).digest('hex').slice(0, 32);
  return `thinker-${digest}`;
}
