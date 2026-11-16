/**
 * Default value of every URL slot (ADR 0012): the URL a connection uses when
 * it sets none, region, plan and deployment included. The same function feeds
 * the dashboard (`default` of each slot) and the resolution without override,
 * so what the screen shows is what the account calls.
 */
import {
  OPENCODE_GO_INFERENCE_BASE,
  OPENCODE_INFERENCE_BASE,
  PROVIDER_ENDPOINTS,
  resolveEndpointKey,
} from '../proxy/provider-endpoints';
import { resolveSubscriptionEndpointKey } from '../proxy/provider-hooks';
import { resolveForwardEndpoint } from '../proxy/forward-endpoint-resolver';
import { getBedrockMantleBaseUrl, getBedrockRuntimeBaseUrl } from '../bedrock-region';
import { qwenRegionModelsUrl } from '../qwen-region';
import { getMinimaxBaseUrl } from '../oauth/minimax/minimax-oauth-helpers';
import {
  getKiroOidcBaseUrl,
  KIRO_DEFAULT_START_URL,
  KIRO_OIDC_DEFAULT_REGION,
} from '../oauth/kiro/kiro-oidc';
import {
  bedrockCrisProfilesUrl,
  CLINE_PASS_RECOMMENDED_MODELS_URL,
  defaultModelsUrl,
  PIONEER_BASE_MODELS_URL,
} from '../../model-discovery/provider-model-fetcher.service';
import {
  ANTHROPIC_OAUTH_URLS,
  CODE_ASSIST_BASE,
  COPILOT_URLS,
  GEMINI_OAUTH_URLS,
  OPENAI_OAUTH_URLS,
  OPENCODE_CONSOLE_SERVER,
  OPENCODE_GO_USAGE_URL,
  XAI_OAUTH_URLS,
} from './provider-url-constants';
import { canonicalUrlProvider } from './provider-url-scope';

const OAUTH_URLS: Record<string, { authorize: string; token: string; revoke?: string }> = {
  openai: OPENAI_OAUTH_URLS,
  gemini: GEMINI_OAUTH_URLS,
  xai: XAI_OAUTH_URLS,
  anthropic: ANTHROPIC_OAUTH_URLS,
};

/** The endpoint key a connection forwards to before any per-model variant. */
function baseEndpointKey(provider: string, authType: string): string | null {
  const key = resolveEndpointKey(provider);
  if (!key || key.startsWith('custom:')) return null;
  return authType === 'subscription' ? (resolveSubscriptionEndpointKey(key) ?? key) : key;
}

/** Base of an endpoint key, moved to the connection's region when that applies. */
function regionalBase(
  provider: string,
  authType: string,
  region: string | null | undefined,
  endpointKey: string,
): string | null {
  const { customEndpoint } = resolveForwardEndpoint({
    provider,
    authType,
    model: '',
    providerRegion: region ?? null,
  });
  if (customEndpoint) return customEndpoint.baseUrl;
  return PROVIDER_ENDPOINTS[endpointKey]?.baseUrl ?? null;
}

const OPENCODE_BASES: Record<string, string> = {
  opencode: OPENCODE_INFERENCE_BASE,
  'opencode-go': OPENCODE_GO_INFERENCE_BASE,
};

/** Endpoint keys of the per-protocol inference slots. */
const VARIANT_ENDPOINT_KEYS: Record<string, Record<string, string>> = {
  inference_responses: { openai: 'openai-responses', xai: 'xai-responses' },
  inference_anthropic: { commandcode: 'commandcode-anthropic' },
};

/**
 * The URL a slot of a connection uses with no override, or null when the
 * provider has no such URL (or it depends on data only the flow has).
 */
export function defaultProviderUrl(
  provider: string,
  authType: string | null | undefined,
  region: string | null | undefined,
  slotId: string,
): string | null {
  const id = canonicalUrlProvider(provider);
  const auth = authType ?? 'api_key';
  const opencodeBase = OPENCODE_BASES[id];
  switch (slotId) {
    case 'inference': {
      if (opencodeBase) return opencodeBase;
      const key = baseEndpointKey(provider, auth);
      return key ? regionalBase(provider, auth, region, key) : null;
    }
    case 'inference_openai':
      return opencodeBase ? `${opencodeBase}/openai` : null;
    case 'inference_google':
      return opencodeBase ? `${opencodeBase}/google` : null;
    case 'inference_anthropic':
      if (opencodeBase) return `${opencodeBase}/anthropic`;
      return (
        PROVIDER_ENDPOINTS[VARIANT_ENDPOINT_KEYS.inference_anthropic[id] ?? '']?.baseUrl ?? null
      );
    case 'inference_responses':
      return (
        PROVIDER_ENDPOINTS[VARIANT_ENDPOINT_KEYS.inference_responses[id] ?? '']?.baseUrl ?? null
      );
    case 'inference_mantle':
      return id === 'bedrock' ? getBedrockMantleBaseUrl(region) : null;
    case 'inference_runtime':
      return id === 'bedrock' ? getBedrockRuntimeBaseUrl(region) : null;
    case 'models':
      return defaultModelsUrl(id, auth, region);
    case 'models_base_catalog':
      return id === 'pioneer' ? PIONEER_BASE_MODELS_URL : null;
    case 'models_recommended':
      return id === 'cline-pass' ? CLINE_PASS_RECOMMENDED_MODELS_URL : null;
    case 'cris_profiles':
      return id === 'bedrock' ? bedrockCrisProfilesUrl(region) : null;
    case 'region_probe_singapore':
    case 'region_probe_us':
    case 'region_probe_beijing':
      return id === 'qwen'
        ? qwenRegionModelsUrl(
            slotId.slice('region_probe_'.length) as 'singapore' | 'us' | 'beijing',
          )
        : null;
    case 'usage':
      return id === 'opencode-go' ? OPENCODE_GO_USAGE_URL : null;
    case 'console':
      return opencodeBase ? OPENCODE_CONSOLE_SERVER : null;
    case 'oauth_authorize':
      return OAUTH_URLS[id]?.authorize ?? null;
    case 'oauth_token':
      return OAUTH_URLS[id]?.token ?? null;
    case 'oauth_revoke':
      return OAUTH_URLS[id]?.revoke ?? null;
    case 'oauth_redirect':
      return id === 'anthropic' ? ANTHROPIC_OAUTH_URLS.redirect : null;
    case 'oauth':
      return id === 'minimax' ? getMinimaxBaseUrl(region === 'cn' ? 'cn' : 'global') : null;
    case 'device_code':
      return id === 'copilot' ? COPILOT_URLS.deviceCode : null;
    case 'device_token':
      return id === 'copilot' ? COPILOT_URLS.deviceToken : null;
    case 'token_exchange':
      return id === 'copilot' ? COPILOT_URLS.tokenExchange : null;
    case 'code_assist':
      return id === 'gemini' ? CODE_ASSIST_BASE : null;
    case 'oidc':
      return id === 'kiro'
        ? getKiroOidcBaseUrl(process.env.KIRO_OIDC_REGION || KIRO_OIDC_DEFAULT_REGION)
        : null;
    case 'start_url':
      return id === 'kiro' ? process.env.KIRO_START_URL || KIRO_DEFAULT_START_URL : null;
    default:
      return null;
  }
}

/**
 * The slot whose override a slot follows when it has none of its own: the
 * protocol variants and the model listing move with the inference base (a
 * proxy or simulator in front of the whole API). Nothing that receives a
 * refresh token ever derives.
 */
export function derivedFromSlot(provider: string, slotId: string): string | null {
  const id = canonicalUrlProvider(provider);
  switch (slotId) {
    case 'inference_responses':
    case 'inference_anthropic':
    case 'inference_openai':
    case 'inference_google':
      return 'inference';
    case 'models':
      return id === 'bedrock' ? 'inference_mantle' : 'inference';
    default:
      return null;
  }
}

/**
 * The slot that serves an endpoint key, once ProviderClient picked the
 * per-model variant (Responses, Anthropic, Google, Mantle or Runtime).
 */
export function inferenceSlotForEndpoint(endpointKey: string): string {
  if (endpointKey === 'openai-responses' || endpointKey === 'xai-responses') {
    return 'inference_responses';
  }
  // BytePlus's Anthropic endpoint serves only its subscription: the `inference` slot.
  if (endpointKey === 'commandcode-anthropic') return 'inference_anthropic';
  if (endpointKey.startsWith('bedrock-runtime')) return 'inference_runtime';
  if (endpointKey.startsWith('bedrock')) return 'inference_mantle';
  const opencode = /^opencode(?:-go)?(-responses|-anthropic|-google)?$/.exec(endpointKey);
  if (opencode) {
    if (opencode[1] === '-anthropic') return 'inference_anthropic';
    if (opencode[1] === '-google') return 'inference_google';
    return 'inference_openai';
  }
  return 'inference';
}
