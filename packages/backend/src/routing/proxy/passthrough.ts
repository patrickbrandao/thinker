import { inferProviderFromModel } from 'thinker-shared';
import { PROVIDER_BY_ID_OR_ALIAS } from '../../common/constants/providers';
import { stripVendorPrefix } from '../../common/constants/openai-models';
import {
  PROVIDER_ENDPOINTS,
  resolveEndpointKey,
  type ProviderEndpoint,
} from './provider-endpoints';

/**
 * Passthrough routes (ADR-free, maintainer decision 2026-11-05): embeddings,
 * audio transcription and Anthropic token counting go straight to the
 * provider named by the model, with the agent's credential for it. No
 * complexity routing, fallback chain or virtual models: the caller picks the
 * model (harness-chatwoot G1/G2, harness-anthropic-sdk G1).
 */

export type PassthroughKind = 'embeddings' | 'transcriptions' | 'count_tokens';

export interface PassthroughTarget {
  /** Registry id of the provider (`openai`, `mistral`, ...). */
  provider: string;
  /** Model id as the provider expects it. */
  model: string;
  endpoint: ProviderEndpoint;
}

/**
 * The provider and bare model a passthrough request names: `provider/model`
 * when the prefix is a known provider, else the provider inferred from the
 * model id. Null when neither applies.
 */
export function resolvePassthroughTarget(rawModel: unknown): PassthroughTarget | null {
  if (typeof rawModel !== 'string' || !rawModel.trim()) return null;
  const model = rawModel.trim();
  const slash = model.indexOf('/');
  const prefixed =
    slash > 0 ? PROVIDER_BY_ID_OR_ALIAS.get(model.slice(0, slash).toLowerCase()) : undefined;
  const provider = prefixed?.id ?? inferProviderFromModel(model);
  if (!provider) return null;
  const endpointKey = resolveEndpointKey(provider);
  const endpoint = endpointKey ? PROVIDER_ENDPOINTS[endpointKey] : undefined;
  if (!endpoint) return null;
  return {
    provider,
    model: prefixed ? model.slice(slash + 1) : stripVendorPrefix(model),
    endpoint,
  };
}

/**
 * The upstream URL for a passthrough kind, or null when the provider's wire
 * format has no such route. OpenAI-compatible endpoints serve embeddings and
 * transcriptions next to chat completions; Anthropic serves count_tokens next
 * to messages.
 */
export function passthroughUrl(target: PassthroughTarget, kind: PassthroughKind): string | null {
  const { endpoint, model } = target;
  const path = endpoint.buildPath(model);
  if (kind === 'count_tokens') {
    if (endpoint.format !== 'anthropic' || !path.endsWith('/messages')) return null;
    return `${endpoint.baseUrl}${path}/count_tokens`;
  }
  if (endpoint.format !== 'openai' || !path.endsWith('/chat/completions')) return null;
  const suffix = kind === 'embeddings' ? '/embeddings' : '/audio/transcriptions';
  return `${endpoint.baseUrl}${path.slice(0, -'/chat/completions'.length)}${suffix}`;
}

/** Fields Anthropic's count_tokens accepts (it rejects the rest of a Messages body). */
const COUNT_TOKENS_FIELDS = [
  'model',
  'messages',
  'system',
  'tools',
  'tool_choice',
  'thinking',
  'mcp_servers',
];

export function countTokensBody(
  body: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of COUNT_TOKENS_FIELDS) {
    if (body[field] !== undefined) out[field] = body[field];
  }
  out.model = model;
  return out;
}
