/**
 * Editable URLs per provider account (ADR 0012, docs/dev/urls-por-conta.md).
 *
 * A slot is one named URL a provider connection uses. This catalog holds the
 * static facts (id, purpose, kind, what credential it receives, which account
 * types have it); the default value of each slot depends on region, plan and
 * deployment and is computed by the backend (`defaultProviderUrl`), so the
 * value the dashboard shows is exactly the one the account uses.
 */

/** `base`: replaces a base and the provider's path is appended. `url`: used as is. */
export type ProviderUrlKind = 'base' | 'url';

/**
 * What goes to the URL: nothing, the access token / API key, the refresh token
 * (or the account's long-lived token), or a client secret / authorization or
 * device code.
 */
export type ProviderUrlCredential = 'none' | 'access' | 'refresh' | 'secret';

export type ProviderUrlAuthType = 'api_key' | 'subscription';

export interface ProviderUrlSlot {
  /** Stable snake_case id: `inference`, `inference_responses`, `models`, `oauth_token`... */
  id: string;
  /** Translation key of the purpose (dashboard): `providerUrls.purpose.<purpose>`. */
  purpose: string;
  /** English label, a fallback for clients without translations (CLI, MCP). */
  label: string;
  kind: ProviderUrlKind;
  credential: ProviderUrlCredential;
  /** Account types where the slot exists. */
  authTypes: ProviderUrlAuthType[];
}

type SlotMeta = Omit<ProviderUrlSlot, 'id' | 'authTypes'>;

const SLOT_META: Record<string, SlotMeta> = {
  inference: { purpose: 'inference', label: 'Inference', kind: 'base', credential: 'access' },
  inference_responses: {
    purpose: 'inference_responses',
    label: 'Inference (Responses API)',
    kind: 'base',
    credential: 'access',
  },
  inference_anthropic: {
    purpose: 'inference_anthropic',
    label: 'Inference (Anthropic Messages)',
    kind: 'base',
    credential: 'access',
  },
  inference_openai: {
    purpose: 'inference_openai',
    label: 'Inference (OpenAI protocol)',
    kind: 'base',
    credential: 'access',
  },
  inference_google: {
    purpose: 'inference_google',
    label: 'Inference (Google protocol)',
    kind: 'base',
    credential: 'access',
  },
  inference_mantle: {
    purpose: 'inference_mantle',
    label: 'Inference (Bedrock Mantle)',
    kind: 'base',
    credential: 'access',
  },
  inference_runtime: {
    purpose: 'inference_runtime',
    label: 'Inference (Bedrock Runtime)',
    kind: 'base',
    credential: 'access',
  },
  models: { purpose: 'models', label: 'Model list', kind: 'url', credential: 'access' },
  models_base_catalog: {
    purpose: 'models_base_catalog',
    label: 'Base model catalog',
    kind: 'url',
    credential: 'none',
  },
  models_recommended: {
    purpose: 'models_recommended',
    label: 'Recommended models',
    kind: 'url',
    credential: 'none',
  },
  cris_profiles: {
    purpose: 'cris_profiles',
    label: 'Inference profiles (CRIS)',
    kind: 'url',
    credential: 'access',
  },
  region_probe_singapore: {
    purpose: 'region_probe',
    label: 'Region detection (Singapore)',
    kind: 'url',
    credential: 'access',
  },
  region_probe_us: {
    purpose: 'region_probe',
    label: 'Region detection (US)',
    kind: 'url',
    credential: 'access',
  },
  region_probe_beijing: {
    purpose: 'region_probe',
    label: 'Region detection (Beijing)',
    kind: 'url',
    credential: 'access',
  },
  usage: { purpose: 'usage', label: 'Usage', kind: 'url', credential: 'access' },
  oauth_authorize: {
    purpose: 'oauth_authorize',
    label: 'OAuth authorize',
    kind: 'url',
    credential: 'none',
  },
  oauth_token: {
    purpose: 'oauth_token',
    label: 'OAuth token (exchange and refresh)',
    kind: 'url',
    credential: 'refresh',
  },
  oauth_revoke: {
    purpose: 'oauth_revoke',
    label: 'OAuth revoke',
    kind: 'url',
    credential: 'refresh',
  },
  oauth_redirect: {
    purpose: 'oauth_redirect',
    label: 'OAuth redirect URI',
    kind: 'url',
    credential: 'none',
  },
  oauth: { purpose: 'oauth', label: 'OAuth (code and token)', kind: 'base', credential: 'refresh' },
  device_code: { purpose: 'device_code', label: 'Device code', kind: 'url', credential: 'none' },
  device_token: {
    purpose: 'device_token',
    label: 'Device token',
    kind: 'url',
    credential: 'secret',
  },
  token_exchange: {
    purpose: 'token_exchange',
    label: 'Token exchange',
    kind: 'url',
    credential: 'refresh',
  },
  code_assist: {
    purpose: 'code_assist',
    label: 'Code Assist (onboarding)',
    kind: 'base',
    credential: 'access',
  },
  oidc: { purpose: 'oidc', label: 'OIDC', kind: 'base', credential: 'refresh' },
  start_url: { purpose: 'start_url', label: 'Start URL', kind: 'url', credential: 'none' },
  console: { purpose: 'console', label: 'Console', kind: 'base', credential: 'refresh' },
};

const A: ProviderUrlAuthType[] = ['api_key'];
const S: ProviderUrlAuthType[] = ['subscription'];
const AS: ProviderUrlAuthType[] = ['api_key', 'subscription'];

type SlotSpec = [id: string, authTypes: ProviderUrlAuthType[]];

/** `inference` + `models`: the OpenAI-compatible API-key providers. */
const apiKeyBasic: SlotSpec[] = [
  ['inference', A],
  ['models', A],
];
const bothBasic: SlotSpec[] = [
  ['inference', AS],
  ['models', AS],
];
const opencodeSlots = (extra: SlotSpec[] = []): SlotSpec[] => [
  ['inference', AS],
  ['inference_openai', AS],
  ['inference_anthropic', AS],
  ['inference_google', AS],
  ['models', AS],
  ['console', S],
  ...extra,
];

const SPECS: Record<string, SlotSpec[]> = {
  openai: [
    ['inference', AS],
    ['inference_responses', A],
    ['models', AS],
    ['oauth_authorize', S],
    ['oauth_token', S],
    ['oauth_revoke', S],
  ],
  anthropic: [
    ['inference', AS],
    ['models', AS],
    ['oauth_authorize', S],
    ['oauth_token', S],
    ['oauth_redirect', S],
  ],
  bedrock: [
    ['inference_mantle', A],
    ['inference_runtime', A],
    ['models', A],
    ['cris_profiles', A],
  ],
  vertex: [['inference', A]],
  gemini: [
    ['inference', AS],
    ['models', A],
    ['oauth_authorize', S],
    ['oauth_token', S],
    ['oauth_revoke', S],
    ['code_assist', S],
  ],
  copilot: [
    ['device_code', S],
    ['device_token', S],
    ['token_exchange', S],
    ['inference', S],
    ['models', S],
  ],
  kiro: [
    ['oidc', S],
    ['start_url', S],
    ['inference', S],
    ['models', S],
  ],
  minimax: [
    ['inference', AS],
    ['models', AS],
    ['oauth', S],
  ],
  xai: [
    ['inference', AS],
    ['inference_responses', A],
    ['models', AS],
    ['oauth_authorize', S],
    ['oauth_token', S],
    ['oauth_revoke', S],
  ],
  opencode: opencodeSlots(),
  'opencode-go': opencodeSlots([['usage', S]]),
  qwen: [
    ['inference', AS],
    ['models', AS],
    ['region_probe_singapore', A],
    ['region_probe_us', A],
    ['region_probe_beijing', A],
  ],
  byteplus: bothBasic,
  commandcode: [
    ['inference', AS],
    ['inference_anthropic', AS],
    ['models', AS],
  ],
  pioneer: [
    ['inference', A],
    ['models', A],
    ['models_base_catalog', A],
  ],
  'cline-pass': [
    ['inference', AS],
    ['models_recommended', AS],
  ],
  moonshot: [
    ['inference', AS],
    ['models', A],
  ],
  mistral: bothBasic,
  nous: bothBasic,
  xiaomi: bothBasic,
  zai: bothBasic,
  'ollama-cloud': bothBasic,
  deepseek: apiKeyBasic,
  cerebras: apiKeyBasic,
  groq: apiKeyBasic,
  huggingface: apiKeyBasic,
  kilo: apiKeyBasic,
  atlascloud: apiKeyBasic,
  edenai: apiKeyBasic,
  requesty: apiKeyBasic,
  meta: apiKeyBasic,
  nvidia: apiKeyBasic,
  openrouter: apiKeyBasic,
  fireworks: apiKeyBasic,
};

/** Every provider's slots, keyed by canonical provider id. */
export const PROVIDER_URL_SLOTS: Record<string, ProviderUrlSlot[]> = Object.fromEntries(
  Object.entries(SPECS).map(([provider, specs]) => [
    provider,
    specs.map(([id, authTypes]) => ({ id, ...SLOT_META[id]!, authTypes })),
  ]),
);

/** The slots a connection of this provider (canonical id) and auth type has. */
export function providerUrlSlots(provider: string, authType: string): ProviderUrlSlot[] {
  return (PROVIDER_URL_SLOTS[provider.toLowerCase()] ?? []).filter((slot) =>
    (slot.authTypes as string[]).includes(authType),
  );
}

/** Maximum length of a stored URL override. */
export const PROVIDER_URL_MAX_LENGTH = 2048;

/** A connection's overrides as stored: slot id → URL. Only values that differ from the default. */
export type ProviderUrlOverrides = Record<string, string>;
