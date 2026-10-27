import { DEFAULT_TIER_SLOT, TIER_SLOTS, type ModelRoute } from 'thinker-shared';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { expandProviderNames } from '../../common/constants/providers';
import { readFallbackRoutes, readOverrideRoute } from '../routing-core/route-helpers';
import type { SpecificityContextSource, TierContextSource } from './model-list-context';
import {
  buildVirtualModelChain,
  snapshotOverrideAvailable,
  tierChainRoutes,
  type RouteSnapshot,
  type VirtualModelChainSource,
} from './virtual-model-chain';

export interface LinkedRoutesInput {
  complexityRoutingEnabled: boolean;
  tiers: readonly TierContextSource[];
  /** Active specificity assignments; ignored with complexity routing off. */
  specificity: readonly SpecificityContextSource[];
  /** The agent's enabled virtual models. */
  virtuals: readonly VirtualModelChainSource[];
  snapshot: RouteSnapshot;
}

/**
 * Every route `auto` and the enabled virtual models can reach, primaries and
 * fallbacks, for the `restricted` model listing. `auto` covers the same
 * destinations as its context length: the Default tier alone with complexity
 * routing off, otherwise every tier slot plus the active specificity
 * assignments.
 */
export async function collectLinkedRoutes(input: LinkedRoutesInput): Promise<ModelRoute[]> {
  const { snapshot } = input;
  const available = (route: ModelRoute) => snapshotOverrideAvailable(route, snapshot);
  const routes: ModelRoute[] = [];
  const slots = new Set<string>(input.complexityRoutingEnabled ? TIER_SLOTS : [DEFAULT_TIER_SLOT]);
  for (const tier of input.tiers) {
    if (!slots.has(tier.tier)) continue;
    const override = readOverrideRoute(tier);
    routes.push(...tierChainRoutes(tier, override ? available(override) : false));
  }
  if (input.complexityRoutingEnabled) {
    for (const assignment of input.specificity) {
      const override = readOverrideRoute(assignment);
      if (override) routes.push(override);
      routes.push(...(readFallbackRoutes(assignment) ?? []));
    }
  }
  const defaultTier = input.tiers.find((t) => t.tier === DEFAULT_TIER_SLOT) ?? null;
  for (const virtual of input.virtuals) {
    const chain = await buildVirtualModelChain(virtual, defaultTier, {
      isDefaultOverrideAvailable: available,
    });
    routes.push(...chain.map((entry) => entry.route));
  }
  return routes;
}

/** Whether a catalog model is the target of a route (provider, auth type, model id). */
export function catalogModelMatchesRoute(model: DiscoveredModel, route: ModelRoute): boolean {
  if (model.id !== route.model) return false;
  if (!route.provider) return true;
  if (!expandProviderNames([route.provider]).has(model.provider.toLowerCase())) return false;
  return !route.authType || !model.authType || model.authType === route.authType;
}
