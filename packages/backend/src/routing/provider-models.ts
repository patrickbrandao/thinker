import type { DiscoveredModel } from '../model-discovery/model-fetcher';
import type { TenantProvider } from '../entities/tenant-provider.entity';
import type { CustomProvider } from '../entities/custom-provider.entity';

/**
 * Workspace model catalog for Providers → Models: every model the
 * workspace's connections offer, one entry per (provider, model id), with the
 * connections ("accounts") that serve it and each account's own price.
 */

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
  /** Custom providers: the name the user gave it. */
  provider_name: string | null;
  context_window: number | null;
  capability_reasoning: boolean;
  capability_code: boolean;
  capabilities: string[];
  input_modalities: string[];
  output_modalities: string[];
  supported_endpoints: string[];
  long_context_pricing: DiscoveredModel['longContextPricing'] | null;
  accounts: ProviderModelAccount[];
}

const PER_MILLION = 1_000_000;

function kindOf(row: Pick<TenantProvider, 'auth_type'>, custom?: CustomProvider): ModelAccountKind {
  if (row.auth_type === 'local' || custom?.local_type) return 'local';
  return row.auth_type === 'subscription' ? 'subscription' : 'api_key';
}

export function buildProviderModels(
  rows: TenantProvider[],
  customProviders: CustomProvider[],
  includeInactive: boolean,
): ProviderModelEntry[] {
  const customById = new Map(customProviders.map((cp) => [`custom:${cp.id}`, cp]));
  const byKey = new Map<string, ProviderModelEntry>();

  const entryFor = (
    provider: string,
    id: string,
    seed: () => Omit<ProviderModelEntry, 'accounts' | 'key'>,
  ) => {
    const key = `${provider}::${id}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, ...seed(), accounts: [] };
      byKey.set(key, entry);
    }
    return entry;
  };

  for (const row of rows) {
    if (!includeInactive && !row.is_active) continue;
    const custom = customById.get(row.provider);
    const kind = kindOf(row, custom);
    const account = (prices: {
      input: number | null;
      output: number | null;
      cacheRead?: number | null;
      cacheWrite?: number | null;
    }): ProviderModelAccount => ({
      connection_id: row.id,
      label: row.label,
      auth_type: row.auth_type,
      kind,
      is_active: row.is_active,
      input_price_per_token: prices.input,
      output_price_per_token: prices.output,
      cache_read_price_per_token: prices.cacheRead ?? null,
      cache_write_price_per_token: prices.cacheWrite ?? null,
      models_fetched_at: row.models_fetched_at ?? null,
    });

    if (custom) {
      for (const m of custom.models ?? []) {
        const entry = entryFor(row.provider, m.model_name, () => ({
          id: m.model_name,
          display_name: m.model_name,
          provider: row.provider,
          provider_name: custom.name,
          context_window: m.context_window ?? null,
          capability_reasoning: false,
          capability_code: false,
          capabilities: [...(m.capabilities ?? [])].map(String),
          input_modalities: [],
          output_modalities: [],
          supported_endpoints: [],
          long_context_pricing: null,
        }));
        entry.accounts.push(
          account({
            input:
              m.input_price_per_million_tokens != null
                ? m.input_price_per_million_tokens / PER_MILLION
                : null,
            output:
              m.output_price_per_million_tokens != null
                ? m.output_price_per_million_tokens / PER_MILLION
                : null,
          }),
        );
      }
      continue;
    }

    for (const m of row.cached_models ?? []) {
      if (!m?.id) continue;
      const entry = entryFor(row.provider, m.id, () => ({
        id: m.id,
        display_name: m.displayName || m.id,
        provider: row.provider,
        provider_name: null,
        context_window: m.contextWindow ?? null,
        capability_reasoning: !!m.capabilityReasoning,
        capability_code: !!m.capabilityCode,
        capabilities: [...(m.capabilities ?? [])].map(String),
        input_modalities: [...(m.inputModalities ?? [])].map(String),
        output_modalities: [...(m.outputModalities ?? [])].map(String),
        supported_endpoints: [...(m.supportedEndpoints ?? [])],
        long_context_pricing: m.longContextPricing ?? null,
      }));
      // The widest context any account reports wins.
      if ((m.contextWindow ?? 0) > (entry.context_window ?? 0))
        entry.context_window = m.contextWindow;
      entry.accounts.push(
        account({
          input: m.inputPricePerToken,
          output: m.outputPricePerToken,
          cacheRead: m.cacheReadPricePerToken,
          cacheWrite: m.cacheWritePricePerToken,
        }),
      );
    }
  }

  return [...byKey.values()].sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.display_name.localeCompare(b.display_name),
  );
}
