import type { ModelCapability, ModelModality } from 'thinker-shared';
import { fetchJson } from './core.js';

export type ModelAccountKind = 'api_key' | 'subscription' | 'local';

export interface ProviderModelAccount {
  connection_id: string;
  label: string;
  auth_type: string;
  kind: ModelAccountKind;
  is_active: boolean;
  input_price_per_token: number | null;
  output_price_per_token: number | null;
  cache_read_price_per_token: number | null;
  cache_write_price_per_token: number | null;
  models_fetched_at: string | null;
}

export interface ProviderModelEntry {
  key: string;
  id: string;
  display_name: string;
  provider: string;
  provider_name: string | null;
  context_window: number | null;
  capability_reasoning: boolean;
  capability_code: boolean;
  capabilities: ModelCapability[];
  input_modalities: ModelModality[];
  output_modalities: ModelModality[];
  supported_endpoints: string[];
  long_context_pricing: {
    thresholdTokens?: number;
    inputPricePerToken?: number;
    outputPricePerToken?: number;
  } | null;
  accounts: ProviderModelAccount[];
}

/** Every model the workspace's connections offer, with the accounts serving each. */
export function getProviderModels(includeInactive: boolean) {
  return fetchJson<{ models: ProviderModelEntry[] }>(
    '/providers/models',
    includeInactive ? { include_inactive: 'true' } : undefined,
    { cache: false },
  );
}
