import { isCatalogSyncEnabled } from '../common/utils/catalog-sync';

export type RoutingStatus =
  | { enabled: true; reason: null }
  | { enabled: false; reason: 'no_provider' | 'pricing_cache_empty' | 'no_routable_models' };

export interface RoutingStatusInputs {
  /** The tenant's provider connections. */
  providers: ReadonlyArray<{ is_active: boolean }>;
  /** Whether any tier of the agent resolves to a model. */
  hasRoutableTier: () => Promise<boolean>;
  /** Number of entries in the OpenRouter pricing cache. */
  pricingCacheSize: () => number;
}

/**
 * Whether a harness can route yet, and why not. Shared by
 * `GET /api/v1/routing/:agent/status` and the MCP `thinker_routing_status`
 * tool so the two never disagree (#75).
 *
 * An empty pricing cache only explains an agent that cannot route: it never
 * blocks one that can (right after boot, or when the OpenRouter fetch failed).
 * With THINKER_CATALOG_SYNC=false the cache is empty by design, so it is not
 * blamed at all.
 */
export async function resolveRoutingStatus(inputs: RoutingStatusInputs): Promise<RoutingStatus> {
  if (!inputs.providers.some((p) => p.is_active)) return { enabled: false, reason: 'no_provider' };
  if (await inputs.hasRoutableTier()) return { enabled: true, reason: null };
  const pricingCacheEmpty = isCatalogSyncEnabled() && inputs.pricingCacheSize() === 0;
  return {
    enabled: false,
    reason: pricingCacheEmpty ? 'pricing_cache_empty' : 'no_routable_models',
  };
}
