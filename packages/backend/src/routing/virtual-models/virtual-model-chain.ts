import type { ModelRoute, ResponseMode } from 'thinker-shared';
import {
  DEFAULT_TIER_SLOT,
  modelParamsScopeForTier,
  modelParamsScopeForVirtualModel,
} from 'thinker-shared';
import type { VirtualModel } from '../../entities/virtual-model.entity';
import type { TierAssignment } from '../../entities/tier-assignment.entity';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { expandProviderNames } from '../../common/constants/providers';
import { openAiModelId } from '../routing-core/public-model-id';
import {
  readAutoAssignedRoute,
  readFallbackRoutes,
  readOverrideRoute,
  routeMatches,
} from '../routing-core/route-helpers';
import { effectiveRoutesForResponseMode } from '../routing-core/response-mode-guard';

/** One step of a virtual model's chain (ADR 0004, section 4). */
export interface VirtualModelChainEntry {
  route: ModelRoute;
  /** `agent_model_params` scope the route's params are configured under. */
  paramsScope: string;
  /** True when the route was appended from the Default tier. */
  fromDefault: boolean;
}

export type VirtualModelChainSource = Pick<
  VirtualModel,
  'id' | 'override_route' | 'fallback_routes' | 'continue_on_default'
>;

export type DefaultTierChainSource = Pick<
  TierAssignment,
  'override_route' | 'auto_assigned_route' | 'fallback_routes'
>;

/**
 * Routes of a tier assignment in the order ResolveService.buildResolvedRouteChain
 * walks them: the override, its fallbacks, then the legacy auto-assigned
 * route; with no override, the auto-assigned route leads.
 */
export function tierChainRoutes(tier: DefaultTierChainSource): ModelRoute[] {
  const override = readOverrideRoute(tier);
  const autoAssigned = readAutoAssignedRoute(tier);
  const fallbacks = readFallbackRoutes(tier) ?? [];
  const ordered = override ? [override, ...fallbacks, autoAssigned] : [autoAssigned, ...fallbacks];
  return ordered.filter((r): r is ModelRoute => r !== null);
}

/**
 * The configured chain of a virtual model, before any availability check:
 * its primary and fallbacks, then, with `continue_on_default`, the Default
 * tier's chain. A route already in the chain is not repeated; identity is
 * (provider, authType, model, keyLabel), so the same model on two keys stays
 * two routes.
 */
export function buildVirtualModelChain(
  virtualModel: VirtualModelChainSource,
  defaultTier: DefaultTierChainSource | null | undefined,
): VirtualModelChainEntry[] {
  const chain: VirtualModelChainEntry[] = [];
  const push = (route: ModelRoute | null, paramsScope: string, fromDefault: boolean) => {
    if (!route) return;
    if (chain.some((entry) => routeMatches(entry.route, route))) return;
    chain.push({ route, paramsScope, fromDefault });
  };

  const ownScope = modelParamsScopeForVirtualModel(virtualModel.id);
  push(readOverrideRoute(virtualModel), ownScope, false);
  for (const route of readFallbackRoutes(virtualModel) ?? []) push(route, ownScope, false);

  if (virtualModel.continue_on_default && defaultTier) {
    const defaultScope = modelParamsScopeForTier(DEFAULT_TIER_SLOT);
    for (const route of tierChainRoutes(defaultTier)) push(route, defaultScope, true);
  }
  return chain;
}

/**
 * Real model ids the name of a virtual model shadows in this catalog, ignoring
 * case: public ids (`openAiModelId`, which for a custom provider without an
 * alias is its `custom:<uuid>/<model>` id) and native ids
 * (`DiscoveredModel.id`). The internal `custom:<uuid>/…` id of a custom
 * provider that publishes under an alias is left out (ADR 0004, section 6).
 */
export function computeShadows(name: string, catalog: readonly DiscoveredModel[]): string[] {
  const wanted = name.toLowerCase();
  const shadows: string[] = [];
  const add = (id: string) => {
    if (id.toLowerCase() === wanted && !shadows.includes(id)) shadows.push(id);
  };
  for (const model of catalog) {
    add(openAiModelId(model));
    if (!model.provider.toLowerCase().startsWith('custom:')) add(model.id);
  }
  return shadows;
}

/** What one catalog snapshot says about a route. */
export type SnapshotRouteState =
  | { state: 'available'; contextWindow: number | null }
  | { state: 'unavailable' }
  | { state: 'unknown' };

/**
 * Availability of a route judged from a catalog snapshot alone, with the
 * discovery half of ProviderKeyService.isRouteAvailable: the connection's
 * models include the route's model → available; the connection lists models
 * but not this one → unavailable. A connection with no models in the snapshot
 * (cold discovery) is unknown: isRouteAvailable would fall back to the
 * credential rows, which the snapshot cannot see.
 */
export function snapshotRouteState(
  route: ModelRoute,
  catalog: readonly DiscoveredModel[],
): SnapshotRouteState {
  const providerNames = expandProviderNames([route.provider]);
  const connectionModels = catalog.filter(
    (m) =>
      providerNames.has(m.provider.toLowerCase()) &&
      (!route.authType || !m.authType || m.authType === route.authType),
  );
  if (connectionModels.length === 0) return { state: 'unknown' };
  const windows = connectionModels.filter((m) => m.id === route.model).map((m) => m.contextWindow);
  if (windows.length === 0) return { state: 'unavailable' };
  const known = windows.filter((w) => Number.isFinite(w) && w > 0);
  return { state: 'available', contextWindow: known.length > 0 ? Math.min(...known) : null };
}

/**
 * ADR 0004, section 7: the smallest context window among the available
 * routes of the effective chain (availability, then the response-mode
 * filter), from one catalog snapshot. Null when no route is left, or when any
 * route that could serve the request has an unknown window or unknown
 * availability: publishing a window larger than one of the routes can take
 * would let a client overflow it after a fallback.
 */
export function chainContextLength(
  chain: readonly ModelRoute[],
  responseMode: ResponseMode | null | undefined,
  catalog: readonly DiscoveredModel[],
): number | null {
  const candidates: Array<{ route: ModelRoute; state: SnapshotRouteState }> = [];
  for (const route of chain) {
    const state = snapshotRouteState(route, catalog);
    if (state.state !== 'unavailable') candidates.push({ route, state });
  }
  const [primary, ...rest] = candidates.map((c) => c.route);
  const effective = effectiveRoutesForResponseMode(responseMode, primary, rest);
  const routes = effective.primaryRoute
    ? [effective.primaryRoute, ...(effective.fallbackRoutes ?? [])]
    : [];
  if (routes.length === 0) return null;

  let min = Infinity;
  for (const route of routes) {
    const state = candidates.find((c) => c.route === route)!.state;
    if (state.state !== 'available' || state.contextWindow === null) return null;
    if (state.contextWindow < min) min = state.contextWindow;
  }
  return min;
}
