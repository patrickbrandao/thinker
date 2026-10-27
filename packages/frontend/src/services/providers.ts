/* ── LLM Provider definitions (shared by Routing page) ── */

import {
  META_MODEL_API_MODELS,
  SHARED_PROVIDER_BY_ID,
  type SharedProviderEntry,
} from 'thinker-shared';
import { t, tMaybe } from '../i18n/index.js';

export interface SubscriptionEndpointRegion {
  value: string;
  label: string;
  baseUrlPlaceholder?: string;
}

export interface ProviderDef {
  id: string;
  name: string;
  color: string;
  initial: string;
  subtitle: string;
  models: { label: string; value: string }[];
  keyPrefix: string;
  minKeyLength: number;
  keyPlaceholder: string;
  noKeyRequired?: boolean;
  localOnly?: boolean;
  /** Provider supports agent-side OAuth/subscription auth (setup-token, OAuth, device-login). */
  supportsSubscription?: boolean;
  /** Label shown in the subscription tab for this provider. */
  subscriptionLabel?: string;
  /** Placeholder for the subscription token input (providers that need a pasted token). */
  subscriptionKeyPlaceholder?: string;
  /** Optional note shown near the subscription credential field. */
  subscriptionRequirementNote?: string;
  /**
   * Set when the provider accepts no new subscription connections. Existing
   * connections keep working and stay manageable; this note replaces the
   * connect flow, and catalogs list the provider only where it is connected.
   */
  subscriptionClosedNote?: string;
  /**
   * Credential kind used for subscription auth. Drives the input label and
   * aria-labels in the subscription detail view. Defaults to 'setup-token'
   * for providers that historically used the Anthropic-style setup-token flow.
   */
  subscriptionCredentialKind?: 'setup-token' | 'api-key';
  /** Optional product name used when the subscription credential differs from the provider brand. */
  subscriptionCredentialName?: string;
  /** Instructions text shown in the subscription detail view. */
  subscriptionCommand?: string;
  /** Provider uses GitHub device login instead of token paste. */
  deviceLogin?: boolean;
  /** UI auth mode for subscription flows. */
  subscriptionAuthMode?: 'popup_oauth' | 'popup_paste' | 'device_code' | 'token';
  /** Optional endpoint selector for token-mode subscription providers. */
  subscriptionEndpointRegions?: SubscriptionEndpointRegion[];
  /** Optional endpoint selector for API-key providers with regional hosts. */
  apiKeyEndpointRegions?: SubscriptionEndpointRegion[];
  /**
   * Optional secondary subscription path. Lets a provider expose a pasted-token
   * shortcut alongside its primary OAuth/device-code flow — currently used so
   * MiniMax users can connect their Coding Plan via an `sk-cp-` token without
   * going through the device-code popup.
   */
  subscriptionTokenAlternative?: {
    prefix: string;
    placeholder: string;
    dividerLabel: string;
  };
  /** Provider is subscription-only and should not appear in the API Keys tab. */
  subscriptionOnly?: boolean;
  /** External URL the user should open to sign in and retrieve their token (token mode). */
  subscriptionSignInUrl?: string;
  /** Label for the sign-in button shown alongside the token paste field. */
  subscriptionSignInLabel?: string;
  /** Custom instruction text shown above the sign-in button (overrides the default). */
  subscriptionSignInHint?: string;
  /** Show a beta badge next to the provider name. */
  beta?: boolean;
  /**
   * Default port for a local OpenAI-compatible server (LM Studio today).
   * When set, clicking the tile in self-hosted mode opens the
   * LocalServerDetailView, which probes
   * `http://{localLlmHost}:{defaultLocalPort}/v1` and auto-connects the
   * discovered models.
   */
  defaultLocalPort?: number;
}

/** UI-only overlay fields for each provider. The id must match a `SHARED_PROVIDERS` entry. */
interface ProviderUIOverlay {
  initial: string;
  subtitle: string;
  models: { label: string; value: string }[];
  noKeyRequired?: boolean;
  supportsSubscription?: boolean;
  subscriptionLabel?: string;
  subscriptionKeyPlaceholder?: string;
  subscriptionRequirementNote?: string;
  subscriptionClosedNote?: string;
  subscriptionCredentialKind?: 'setup-token' | 'api-key';
  subscriptionCredentialName?: string;
  subscriptionCommand?: string;
  deviceLogin?: boolean;
  subscriptionAuthMode?: 'popup_oauth' | 'popup_paste' | 'device_code' | 'token';
  subscriptionEndpointRegions?: SubscriptionEndpointRegion[];
  apiKeyEndpointRegions?: SubscriptionEndpointRegion[];
  subscriptionTokenAlternative?: {
    prefix: string;
    placeholder: string;
    dividerLabel: string;
  };
  subscriptionOnly?: boolean;
  subscriptionSignInUrl?: string;
  subscriptionSignInLabel?: string;
  subscriptionSignInHint?: string;
  beta?: boolean;
  /** See ProviderDef.defaultLocalPort. */
  defaultLocalPort?: number;
}

/**
 * Region option whose label follows the dashboard language. The getter is
 * read at render time, so switching language updates open selectors.
 */
function region(
  value: string,
  label: () => string,
  baseUrlPlaceholder?: string,
): SubscriptionEndpointRegion {
  return {
    value,
    get label() {
      return label();
    },
    ...(baseUrlPlaceholder && { baseUrlPlaceholder }),
  };
}

const regionLabel = (key: string) => () => tMaybe(`providerSetup.catalog.regions.${key}`) ?? key;

const PROVIDER_UI: Record<string, ProviderUIOverlay> = {
  qwen: {
    initial: 'Al',
    subtitle: 'Qwen 3.7, DeepSeek, Kimi, GLM via Alibaba Cloud',
    apiKeyEndpointRegions: [
      region('auto', regionLabel('autoDetect')),
      region('beijing', regionLabel('chinaBeijing')),
      region('singapore', regionLabel('singapore')),
      region('us', regionLabel('unitedStates')),
      region(
        'workspace-cn-hongkong',
        regionLabel('chinaHongKong'),
        'https://<workspace-id>.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1',
      ),
      region(
        'workspace-eu-central-1',
        regionLabel('germanyFrankfurt'),
        'https://<workspace-id>.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
      ),
      region(
        'workspace-ap-northeast-1',
        regionLabel('japanTokyo'),
        'https://<workspace-id>.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1',
      ),
      region(
        'custom',
        regionLabel('customEndpoint'),
        'https://<workspace-id>.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
      ),
    ],
    supportsSubscription: true,
    subscriptionLabel: 'Qwen Token Plan',
    subscriptionAuthMode: 'token',
    subscriptionCredentialKind: 'api-key',
    subscriptionCredentialName: 'Qwen Token Plan',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'Qwen Token Plan' });
    },
    models: [],
  },
  anthropic: {
    initial: 'A',
    subtitle: 'Claude Opus 5, Sonnet 5, Fable 5, Haiku 4.5',
    supportsSubscription: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.claudeSubscription');
    },
    subscriptionAuthMode: 'popup_paste',
    models: [],
  },
  vertex: {
    initial: 'GV',
    subtitle: 'Gemini via Google Cloud Vertex AI',
    models: [],
  },
  bedrock: {
    initial: 'AWS',
    subtitle: 'Claude, GPT, Kimi, MiniMax, Nova via Amazon Bedrock',
    apiKeyEndpointRegions: [
      region('us-east-1', regionLabel('usEast1')),
      region('us-east-2', regionLabel('usEast2')),
      region('us-west-2', regionLabel('usWest2')),
      region('eu-west-1', regionLabel('euWest1')),
      region('eu-west-2', regionLabel('euWest2')),
      region('eu-central-1', regionLabel('euCentral1')),
      region('eu-south-1', regionLabel('euSouth1')),
      region('eu-north-1', regionLabel('euNorth1')),
      region('ap-south-1', regionLabel('apSouth1')),
      region('ap-southeast-2', regionLabel('apSoutheast2')),
      region('ap-southeast-3', regionLabel('apSoutheast3')),
      region('ap-northeast-1', regionLabel('apNortheast1')),
      region('sa-east-1', regionLabel('saEast1')),
    ],
    models: [],
  },
  byteplus: {
    initial: 'Bp',
    subtitle: 'Ark Code, Seed Code, DeepSeek, GLM, Kimi',
    supportsSubscription: true,
    subscriptionOnly: true,
    subscriptionLabel: 'ModelArk Coding Plan',
    subscriptionAuthMode: 'token',
    subscriptionCredentialKind: 'api-key',
    subscriptionCredentialName: 'ModelArk Coding Plan',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'ModelArk Coding Plan' });
    },
    models: [],
  },
  cerebras: {
    initial: 'Cb',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.cerebras');
    },
    models: [],
  },
  'cline-pass': {
    initial: 'CP',
    subtitle: 'GLM, Kimi, DeepSeek, MiMo, MiniMax, Qwen via ClinePass',
    supportsSubscription: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.subscriptionOf', { name: 'ClinePass' });
    },
    subscriptionAuthMode: 'token',
    subscriptionCredentialKind: 'api-key',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'ClinePass' });
    },
    subscriptionSignInUrl: 'https://app.cline.bot',
    get subscriptionSignInLabel() {
      return t('providerSetup.catalog.signInTo', { name: 'ClinePass' });
    },
    subscriptionOnly: true,
    models: [],
  },
  pioneer: {
    initial: 'P',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.pioneer');
    },
    models: [],
  },
  deepseek: {
    initial: 'D',
    subtitle: 'DeepSeek V4 Pro, V4 Flash, V3.2, R1',
    models: [],
  },
  fireworks: {
    initial: 'Fw',
    subtitle: 'DeepSeek V4, Kimi, Qwen 3.7, Nemotron',
    models: [],
  },
  copilot: {
    initial: 'GH',
    subtitle: 'Claude, GPT, Gemini, Grok via Copilot',
    supportsSubscription: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.subscriptionOf', { name: 'GitHub Copilot' });
    },
    subscriptionAuthMode: 'device_code',
    deviceLogin: true,
    subscriptionOnly: true,
    models: [
      { label: 'Claude Opus 4.6', value: 'copilot/claude-opus-4.6' },
      { label: 'Claude Sonnet 4.6', value: 'copilot/claude-sonnet-4.6' },
      { label: 'Claude Haiku 4.5', value: 'copilot/claude-haiku-4.5' },
      { label: 'GPT-5.4', value: 'copilot/gpt-5.4' },
      { label: 'GPT-5.2 Codex', value: 'copilot/gpt-5.2-codex' },
      { label: 'GPT-5 Mini', value: 'copilot/gpt-5-mini' },
      { label: 'GPT-4.1', value: 'copilot/gpt-4.1' },
      { label: 'GPT-4o', value: 'copilot/gpt-4o' },
      { label: 'GPT-4o Mini', value: 'copilot/gpt-4o-mini' },
      { label: 'Gemini 3.1 Pro', value: 'copilot/gemini-3.1-pro-preview' },
      { label: 'Grok Code Fast 1', value: 'copilot/grok-code-fast-1' },
    ],
  },
  commandcode: {
    initial: 'CC',
    subtitle: 'Claude, DeepSeek, Qwen, Gemini, Kimi',
    supportsSubscription: true,
    subscriptionOnly: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.subscriptionOf', { name: 'Command Code' });
    },
    subscriptionAuthMode: 'token',
    subscriptionCredentialKind: 'api-key',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'Command Code' });
    },
    get subscriptionRequirementNote() {
      return t('providerSetup.catalog.commandCodeRequirement');
    },
    models: [],
  },
  gemini: {
    initial: 'G',
    subtitle: 'Gemini 3.5 Flash, 3.1 Flash-Lite, Gemini 2.5',
    supportsSubscription: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.signInWithGoogle');
    },
    subscriptionAuthMode: 'popup_oauth',
    // Google refuses gemini-cli's OAuth client for Gemini Code Assist for
    // individuals (google-gemini/gemini-cli#29279), so new sign-ins fail.
    get subscriptionClosedNote() {
      return t('providerSetup.catalog.geminiClosed');
    },
    models: [],
  },
  kiro: {
    initial: 'K',
    subtitle: 'Claude, DeepSeek, MiniMax, GLM, Qwen via Kiro',
    supportsSubscription: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.subscriptionOf', { name: 'Kiro' });
    },
    subscriptionAuthMode: 'device_code',
    subscriptionOnly: true,
    beta: true,
    models: [],
  },
  groq: {
    initial: 'Gq',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.groq');
    },
    models: [],
  },
  huggingface: {
    initial: 'HF',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.huggingface');
    },
    models: [],
  },
  kilo: {
    initial: 'K',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.kilo');
    },
    models: [],
  },
  llamacpp: {
    initial: 'Lc',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.llamacpp');
    },
    noKeyRequired: true,
    models: [],
    defaultLocalPort: 8080,
  },
  lmstudio: {
    initial: 'LM',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.lmstudio');
    },
    noKeyRequired: true,
    models: [],
    defaultLocalPort: 1234,
  },
  minimax: {
    initial: 'Mm',
    subtitle: 'MiniMax M3, M2.7, M2.5',
    apiKeyEndpointRegions: [
      region('global', regionLabel('global')),
      region('cn', regionLabel('china')),
    ],
    supportsSubscription: true,
    subscriptionLabel: 'MiniMax Coding Plan',
    subscriptionAuthMode: 'device_code',
    subscriptionTokenAlternative: {
      prefix: 'sk-cp-',
      placeholder: 'sk-cp-...',
      get dividerLabel() {
        return t('providerSetup.catalog.minimaxDivider');
      },
    },
    models: [],
  },
  meta: {
    initial: 'Me',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.meta');
    },
    models: META_MODEL_API_MODELS.map((model) => ({
      label: model.displayName,
      value: model.id,
    })),
  },
  xiaomi: {
    initial: 'Mi',
    subtitle: 'MiMo V2.5 Pro, V2.5, Flash',
    supportsSubscription: true,
    subscriptionLabel: 'Xiaomi MiMo Token Plan',
    subscriptionAuthMode: 'token',
    subscriptionCredentialKind: 'api-key',
    subscriptionCredentialName: 'MiMo Token Plan',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'MiMo Token Plan' });
    },
    subscriptionEndpointRegions: [
      region('cn', regionLabel('mimoCn')),
      region('sgp', regionLabel('mimoSgp')),
      region('ams', regionLabel('mimoAms')),
    ],
    models: [],
  },
  mistral: {
    initial: 'M',
    subtitle: 'Mistral Large, Medium 3.5, Devstral, Codestral',
    supportsSubscription: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.subscriptionOf', { name: 'Mistral Vibe' });
    },
    subscriptionAuthMode: 'token',
    subscriptionCredentialKind: 'api-key',
    subscriptionCredentialName: 'Mistral Vibe',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'Mistral Vibe' });
    },
    models: [],
  },
  moonshot: {
    initial: 'Mo',
    subtitle: 'Kimi K3, K2.7 Code, Kimi for Coding',
    supportsSubscription: true,
    subscriptionLabel: 'Kimi Coding Plan',
    subscriptionAuthMode: 'token',
    subscriptionCredentialKind: 'api-key',
    subscriptionCredentialName: 'Kimi Code',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'Kimi Code' });
    },
    models: [],
  },
  nous: {
    initial: 'N',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.nous');
    },
    supportsSubscription: true,
    subscriptionOnly: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.subscriptionOf', { name: 'NousResearch' });
    },
    subscriptionAuthMode: 'token',
    subscriptionCredentialKind: 'api-key',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'NousResearch' });
    },
    models: [],
  },
  nvidia: {
    initial: 'Nv',
    subtitle: 'Nemotron 3, GLM, Kimi, Qwen via NVIDIA NIM',
    models: [],
  },
  ollama: {
    initial: 'Ol',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.ollama');
    },
    noKeyRequired: true,
    models: [],
  },
  'ollama-cloud': {
    initial: 'Oc',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.ollamaCloud');
    },
    supportsSubscription: true,
    subscriptionOnly: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.subscriptionOf', { name: 'Ollama Cloud' });
    },
    subscriptionAuthMode: 'token',
    subscriptionCredentialKind: 'api-key',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'Ollama Cloud' });
    },
    models: [],
  },
  openai: {
    initial: 'O',
    subtitle: 'GPT-5.6, GPT-5.5, GPT-5.4, Codex',
    supportsSubscription: true,
    subscriptionLabel: 'ChatGPT Plus/Pro/Team',
    subscriptionAuthMode: 'popup_oauth',
    models: [
      { label: 'GPT-4o', value: 'gpt-4o' },
      { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
      { label: 'GPT-4o (2024-11-20)', value: 'gpt-4o-2024-11-20' },
      { label: 'GPT-4.1', value: 'gpt-4.1' },
      { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini' },
      { label: 'GPT-4.1 Nano', value: 'gpt-4.1-nano' },
      { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
      { label: 'GPT-4 Turbo (2024-04-09)', value: 'gpt-4-turbo-2024-04-09' },
      { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
      { label: 'o3', value: 'o3' },
      { label: 'o3 Mini', value: 'o3-mini' },
      { label: 'o4 Mini', value: 'o4-mini' },
      { label: 'o1', value: 'o1' },
      { label: 'o1 Mini', value: 'o1-mini' },
      { label: 'o1 Preview', value: 'o1-preview' },
    ],
  },
  'opencode-go': {
    initial: 'OG',
    subtitle: 'DeepSeek, Qwen, GLM, Kimi, MiMo',
    supportsSubscription: true,
    subscriptionLabel: 'OpenCode Go (beta)',
    subscriptionAuthMode: 'token',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'OpenCode' });
    },
    subscriptionSignInUrl: 'https://opencode.ai/auth',
    get subscriptionSignInLabel() {
      return t('providerSetup.catalog.signInTo', { name: 'OpenCode Go' });
    },
    get subscriptionSignInHint() {
      return t('providerSetup.catalog.opencodeSignInHint');
    },
    subscriptionOnly: true,
    beta: true,
    models: [],
  },
  'opencode-zen': {
    initial: 'OZ',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.opencodeZen');
    },
    models: [],
  },
  openrouter: {
    initial: 'OR',
    get subtitle() {
      return t('providerSetup.catalog.subtitles.openrouter');
    },
    models: [],
  },
  xai: {
    initial: 'X',
    subtitle: 'Grok 4.5, Grok 4.3, Grok Build',
    supportsSubscription: true,
    get subscriptionLabel() {
      return t('providerSetup.catalog.subscriptionOf', { name: 'Grok' });
    },
    subscriptionAuthMode: 'popup_oauth',
    models: [],
  },
  zai: {
    initial: 'Z',
    subtitle: 'GLM 5.2, GLM 5.1, GLM 5 Turbo',
    supportsSubscription: true,
    subscriptionLabel: 'GLM Coding Plan',
    subscriptionAuthMode: 'token',
    get subscriptionKeyPlaceholder() {
      return t('providerSetup.catalog.pasteYourKey', { name: 'Z.ai' });
    },
    subscriptionCredentialKind: 'api-key',
    subscriptionEndpointRegions: [
      region('global', regionLabel('zaiGlobal')),
      region('cn', regionLabel('zaiCn')),
    ],
    models: [],
  },
};

/** @internal Exported for testing only */
export function buildProviderDef(shared: SharedProviderEntry): ProviderDef {
  const overlay = PROVIDER_UI[shared.id];
  if (!overlay) {
    throw new Error(`Missing UI overlay for shared provider "${shared.id}"`);
  }
  const def = {
    id: shared.id,
    name: shared.displayName,
    color: shared.color,
    keyPrefix: shared.keyPrefix,
    minKeyLength: shared.minKeyLength,
    keyPlaceholder: shared.keyPlaceholder,
    localOnly: shared.localOnly || undefined,
  } as ProviderDef;
  // Copy property descriptors (not values) so translated getters on the
  // overlay keep following the active language.
  return Object.defineProperties(def, Object.getOwnPropertyDescriptors(overlay));
}

// Preserve previous ordering (alphabetical-ish by display name) so UI tests
// that index into PROVIDERS don't shift.
const PROVIDER_ORDER = [
  'qwen',
  'anthropic',
  'bedrock',
  'byteplus',
  'cerebras',
  'cline-pass',
  'commandcode',
  'deepseek',
  'fireworks',
  'copilot',
  'gemini',
  'vertex',
  'groq',
  'huggingface',
  'kilo',
  'kiro',
  'llamacpp',
  'lmstudio',
  'meta',
  'minimax',
  'mistral',
  'moonshot',
  'nous',
  'nvidia',
  'ollama',
  'ollama-cloud',
  'openai',
  'opencode-go',
  'opencode-zen',
  'openrouter',
  'pioneer',
  'xai',
  'xiaomi',
  'zai',
];

export const PROVIDERS: ProviderDef[] = PROVIDER_ORDER.map((id) => {
  const shared = SHARED_PROVIDER_BY_ID.get(id);
  /* v8 ignore next 3 -- PROVIDER_ORDER is static and must match shared provider metadata. */
  if (!shared) {
    throw new Error(`Unknown provider id in PROVIDER_ORDER: "${id}"`);
  }
  return buildProviderDef(shared);
});

/**
 * Providers a subscription catalog lists. One closed to new subscriptions
 * stays listed only where the workspace already has that subscription, so
 * existing connections remain reachable.
 */
export function subscriptionCatalog(
  providers: readonly ProviderDef[],
  hasSubscription: (providerId: string) => boolean,
): ProviderDef[] {
  return providers.filter(
    (p) => p.supportsSubscription && (!p.subscriptionClosedNote || hasSubscription(p.id)),
  );
}

/* ── Pipeline stage definitions ────────────────────── */

export interface StageDef {
  id: string;
  step: number;
  label: string;
  desc: string;
}

export const DEFAULT_STAGE: StageDef = {
  id: 'default',
  step: 0,
  get label() {
    return t('providerSetup.stages.default.label');
  },
  get desc() {
    return t('providerSetup.stages.default.desc');
  },
};

export const STAGES: StageDef[] = [
  {
    id: 'simple',
    step: 1,
    get label() {
      return t('providerSetup.stages.simple.label');
    },
    get desc() {
      return t('providerSetup.stages.simple.desc');
    },
  },
  {
    id: 'standard',
    step: 2,
    get label() {
      return t('providerSetup.stages.standard.label');
    },
    get desc() {
      return t('providerSetup.stages.standard.desc');
    },
  },
  {
    id: 'complex',
    step: 3,
    get label() {
      return t('providerSetup.stages.complex.label');
    },
    get desc() {
      return t('providerSetup.stages.complex.desc');
    },
  },
  {
    id: 'reasoning',
    step: 4,
    get label() {
      return t('providerSetup.stages.reasoning.label');
    },
    get desc() {
      return t('providerSetup.stages.reasoning.desc');
    },
  },
];

export const SPECIFICITY_STAGES: StageDef[] = [
  {
    id: 'coding',
    step: 1,
    get label() {
      return t('providerSetup.stages.coding.label');
    },
    get desc() {
      return t('providerSetup.stages.coding.desc');
    },
  },
  {
    id: 'web_browsing',
    step: 2,
    get label() {
      return t('providerSetup.stages.web_browsing.label');
    },
    get desc() {
      return t('providerSetup.stages.web_browsing.desc');
    },
  },
  {
    id: 'data_analysis',
    step: 3,
    get label() {
      return t('providerSetup.stages.data_analysis.label');
    },
    get desc() {
      return t('providerSetup.stages.data_analysis.desc');
    },
  },
  {
    id: 'image_generation',
    step: 4,
    get label() {
      return t('providerSetup.stages.image_generation.label');
    },
    get desc() {
      return t('providerSetup.stages.image_generation.desc');
    },
  },
  {
    id: 'video_generation',
    step: 5,
    get label() {
      return t('providerSetup.stages.video_generation.label');
    },
    get desc() {
      return t('providerSetup.stages.video_generation.desc');
    },
  },
  {
    id: 'social_media',
    step: 6,
    get label() {
      return t('providerSetup.stages.social_media.label');
    },
    get desc() {
      return t('providerSetup.stages.social_media.desc');
    },
  },
  {
    id: 'email_management',
    step: 7,
    get label() {
      return t('providerSetup.stages.email_management.label');
    },
    get desc() {
      return t('providerSetup.stages.email_management.desc');
    },
  },
  {
    id: 'calendar_management',
    step: 8,
    get label() {
      return t('providerSetup.stages.calendar_management.label');
    },
    get desc() {
      return t('providerSetup.stages.calendar_management.desc');
    },
  },
  {
    id: 'trading',
    step: 9,
    get label() {
      return t('providerSetup.stages.trading.label');
    },
    get desc() {
      return t('providerSetup.stages.trading.desc');
    },
  },
];

/* ── Helpers ── */
export { getProvider, getModelLabel } from './provider-utils.js';
