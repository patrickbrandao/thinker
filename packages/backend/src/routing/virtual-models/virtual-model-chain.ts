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
 * Candidate routes of a tier assignment, in the order
 * ResolveService.buildResolvedRouteChain uses them:
 * - override available: the override and its fallbacks only. The legacy
 *   auto-assigned route is never reached, even when it is still stored;
 * - override unavailable: its fallbacks, then the auto-assigned route;
 * - no override: the auto-assigned route, then the fallbacks.
 *
 * `overrideAvailable` is ignored when the tier has no override.
 */
export function tierChainRoutes(
  tier: DefaultTierChainSource,
  overrideAvailable: boolean,
): ModelRoute[] {
  const override = readOverrideRoute(tier);
  const autoAssigned = readAutoAssignedRoute(tier);
  const fallbacks = readFallbackRoutes(tier) ?? [];
  let ordered: Array<ModelRoute | null>;
  if (override && overrideAvailable) ordered = [override, ...fallbacks];
  else if (override) ordered = [...fallbacks, autoAssigned];
  else ordered = [autoAssigned, ...fallbacks];
  return ordered.filter((r): r is ModelRoute => r !== null);
}

type MaybePromise<T> = T | Promise<T>;

export interface BuildVirtualModelChainOptions {
  /**
   * Whether the Default tier's override is available, which decides whether
   * its legacy auto-assigned route can be reached (see tierChainRoutes). The
   * proxy passes ProviderKeyService.isRouteAvailable; the admin listing
   * judges it from its route snapshot. Required, so no caller can reach the
   * legacy route by accident when the override is in fact usable.
   */
  isDefaultOverrideAvailable: (route: ModelRoute) => MaybePromise<boolean>;
  /**
   * Normalizes each route before deduplication, e.g. with the request-time
   * key label (ResolveService.enrichRouteKeyLabel), so `(…, keyLabel: null)`
   * and `(…, keyLabel: "Main")` collapse when "Main" is the default key.
   * Defaults to the route as stored.
   */
  normalize?: (
    route: ModelRoute,
    entry: Omit<VirtualModelChainEntry, 'route'>,
  ) => MaybePromise<ModelRoute>;
}

/**
 * The configured chain of a virtual model, before the availability and
 * transport filters: its primary and fallbacks, then, with
 * `continue_on_default`, the Default tier's chain. Each route goes through
 * `normalize` first; a route already in the chain is then not repeated.
 * Identity is (provider, authType, model, keyLabel), so the same model on two
 * keys stays two routes.
 */
export async function buildVirtualModelChain(
  virtualModel: VirtualModelChainSource,
  defaultTier: DefaultTierChainSource | null | undefined,
  options: BuildVirtualModelChainOptions,
): Promise<VirtualModelChainEntry[]> {
  const normalize = options.normalize ?? ((route: ModelRoute) => route);
  // Every route is normalized concurrently; deduplication then runs over the
  // results in chain order, so the first occurrence still wins.
  const pending: Array<Promise<VirtualModelChainEntry>> = [];
  const add = (route: ModelRoute, paramsScope: string, fromDefault: boolean) => {
    pending.push(
      Promise.resolve(normalize(route, { paramsScope, fromDefault })).then((normalized) => ({
        route: normalized,
        paramsScope,
        fromDefault,
      })),
    );
  };

  const ownScope = modelParamsScopeForVirtualModel(virtualModel.id);
  const primary = readOverrideRoute(virtualModel);
  if (primary) add(primary, ownScope, false);
  for (const route of readFallbackRoutes(virtualModel) ?? []) add(route, ownScope, false);

  if (virtualModel.continue_on_default && defaultTier) {
    const defaultScope = modelParamsScopeForTier(DEFAULT_TIER_SLOT);
    const override = readOverrideRoute(defaultTier);
    const overrideAvailable = override ? await options.isDefaultOverrideAvailable(override) : false;
    for (const route of tierChainRoutes(defaultTier, overrideAvailable)) {
      add(route, defaultScope, true);
    }
  }

  const chain: VirtualModelChainEntry[] = [];
  for (const entry of await Promise.all(pending)) {
    if (chain.some((kept) => routeMatches(kept.route, entry.route))) continue;
    chain.push(entry);
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

/**
 * An active, usable provider record the agent has enabled, as
 * ProviderKeyService.getRouteProviderRecords returns it.
 */
export interface RouteProviderRecord {
  provider: string;
  authType: string | null;
}

/**
 * Everything the snapshot judgement of a route needs, loaded once per request:
 * the agent's discovery catalog and its credential rows. Together they cover
 * both halves of ProviderKeyService.isRouteAvailable without one query per
 * route.
 */
export interface RouteSnapshot {
  catalog: readonly DiscoveredModel[];
  providers: readonly RouteProviderRecord[];
}

interface RouteSnapshotIndex {
  catalog: ReadonlyMap<string, readonly DiscoveredModel[]>;
  providers: ReadonlyMap<string, readonly RouteProviderRecord[]>;
}

/**
 * Catalog and credential rows grouped by lowercase provider name, built once
 * per snapshot (one per request) so judging each route reads only its own
 * provider's entries instead of filtering the whole catalog.
 */
const snapshotIndexes = new WeakMap<RouteSnapshot, RouteSnapshotIndex>();

function snapshotIndex(snapshot: RouteSnapshot): RouteSnapshotIndex {
  let index = snapshotIndexes.get(snapshot);
  if (!index) {
    index = {
      catalog: groupByProvider(snapshot.catalog),
      providers: groupByProvider(snapshot.providers),
    };
    snapshotIndexes.set(snapshot, index);
  }
  return index;
}

function groupByProvider<T extends { provider: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.provider.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** Entries of every provider name in `names`, in snapshot-group order. */
function bucketsFor<T>(groups: ReadonlyMap<string, readonly T[]>, names: ReadonlySet<string>): T[] {
  const out: T[] = [];
  for (const name of names) {
    const group = groups.get(name);
    if (group) out.push(...group);
  }
  return out;
}

/** What one route snapshot says about a route. */
export type SnapshotRouteState =
  | { state: 'available'; contextWindow: number | null }
  | { state: 'unavailable' }
  | { state: 'unknown' };

/**
 * Availability of a route judged from a route snapshot, with the same rules
 * as ProviderKeyService.isRouteAvailable:
 * - the connection's models include the route's model: available;
 * - the connection lists models but not this one: unavailable;
 * - the connection has no models (cold discovery, or a provider the agent no
 *   longer has): Qwen/Alibaba is unavailable; with an active, usable record
 *   for the pinned provider/authType the route is unknown (cold discovery:
 *   reachable, window unknown); without one it is unavailable (provider
 *   disconnected, or disabled for the agent).
 * A route without a provider pin is unknown: isRouteAvailable resolves it by
 * name alone, which the snapshot cannot replay.
 */
export function snapshotRouteState(route: ModelRoute, snapshot: RouteSnapshot): SnapshotRouteState {
  const providerNames = expandProviderNames([route.provider]);
  const index = snapshotIndex(snapshot);
  const connectionModels = bucketsFor(index.catalog, providerNames).filter(
    (m) => !route.authType || !m.authType || m.authType === route.authType,
  );
  if (connectionModels.length === 0) return coldRouteState(route, providerNames, snapshot);
  const windows = connectionModels.filter((m) => m.id === route.model).map((m) => m.contextWindow);
  if (windows.length === 0) return { state: 'unavailable' };
  const known = windows.filter((w) => Number.isFinite(w) && w > 0);
  return { state: 'available', contextWindow: known.length > 0 ? Math.min(...known) : null };
}

/** The credential-row fallback of isRouteAvailable, for a connection with no models. */
function coldRouteState(
  route: ModelRoute,
  providerNames: ReadonlySet<string>,
  snapshot: RouteSnapshot,
): SnapshotRouteState {
  if (!route.provider) return { state: 'unknown' };
  if (providerNames.has('qwen') || providerNames.has('alibaba')) return { state: 'unavailable' };
  const hasRecord = bucketsFor(snapshotIndex(snapshot).providers, providerNames).some(
    (r) => !route.authType || r.authType === route.authType,
  );
  return hasRecord ? { state: 'unknown' } : { state: 'unavailable' };
}

/**
 * ADR 0004, section 7: the smallest context window among the available
 * routes of the effective chain (availability, then the response-mode
 * filter), from one route snapshot. Null when no route is left, or when any
 * route that could serve the request has an unknown window or unknown
 * availability: publishing a window larger than one of the routes can take
 * would let a client overflow it after a fallback.
 */
export function chainContextLength(
  chain: readonly ModelRoute[],
  responseMode: ResponseMode | null | undefined,
  snapshot: RouteSnapshot,
): number | null {
  const window = chainContextWindow(chain, responseMode, snapshot);
  return window.kind === 'known' ? window.value : null;
}

/**
 * What one route snapshot says about the context window of a chain:
 * - `known`: every route that could serve the request has a known window,
 *   and `value` is the smallest;
 * - `unknown`: some such route has an unknown window or unknown availability;
 * - `empty`: no route is left after the availability and transport filters.
 */
export type ChainContextWindow =
  { kind: 'known'; value: number } | { kind: 'unknown' } | { kind: 'empty' };

/**
 * chainContextLength with "no route left" and "window unknown" kept apart,
 * for callers that combine several chains: the `auto` entry of `/v1/models`
 * with complexity routing on skips a destination that cannot serve a request,
 * but must not skip one whose window it cannot judge.
 */
export function chainContextWindow(
  chain: readonly ModelRoute[],
  responseMode: ResponseMode | null | undefined,
  snapshot: RouteSnapshot,
): ChainContextWindow {
  const candidates: Array<{ route: ModelRoute; state: SnapshotRouteState }> = [];
  for (const route of chain) {
    const state = snapshotRouteState(route, snapshot);
    if (state.state !== 'unavailable') candidates.push({ route, state });
  }
  const [primary, ...rest] = candidates.map((c) => c.route);
  const effective = effectiveRoutesForResponseMode(responseMode, primary, rest);
  const routes = effective.primaryRoute
    ? [effective.primaryRoute, ...(effective.fallbackRoutes ?? [])]
    : [];
  if (routes.length === 0) return { kind: 'empty' };

  let min = Infinity;
  for (const route of routes) {
    const state = candidates.find((c) => c.route === route)!.state;
    if (state.state !== 'available' || state.contextWindow === null) return { kind: 'unknown' };
    if (state.contextWindow < min) min = state.contextWindow;
  }
  return { kind: 'known', value: min };
}

/**
 * Whether a tier's override counts as available when only a route snapshot
 * is at hand (see tierChainRoutes). An override the snapshot cannot judge
 * counts as reachable: the legacy auto-assigned route then stays out, and the
 * unknown route makes the context window unknown (the conservative answer).
 */
export function snapshotOverrideAvailable(route: ModelRoute, snapshot: RouteSnapshot): boolean {
  return snapshotRouteState(route, snapshot).state !== 'unavailable';
}

/**
 * ADR 0004, section 7: `context_length` of a virtual model from one route
 * snapshot. The chain is the virtual model's own plus, with
 * `continue_on_default`, the Default tier's, filtered with the virtual
 * model's response mode.
 */
export async function virtualModelContextLength(
  virtualModel: VirtualModelChainSource & Pick<VirtualModel, 'response_mode'>,
  defaultTier: DefaultTierChainSource | null | undefined,
  snapshot: RouteSnapshot,
): Promise<number | null> {
  const chain = await buildVirtualModelChain(virtualModel, defaultTier, {
    isDefaultOverrideAvailable: (route) => snapshotOverrideAvailable(route, snapshot),
  });
  return chainContextLength(
    chain.map((entry) => entry.route),
    virtualModel.response_mode,
    snapshot,
  );
}

/**
 * Whether a virtual model can take traffic per one route snapshot: enabled,
 * and its effective chain (own routes, then the Default slot's chain with
 * `continue_on_default`, the same chain the proxy builds) keeps at least one
 * route after the availability and transport filters. Only the `default`
 * slot is ever appended, whatever the other tiers hold.
 */
export async function virtualModelRoutable(
  virtualModel: VirtualModelChainSource & Pick<VirtualModel, 'response_mode' | 'enabled'>,
  defaultTier: DefaultTierChainSource | null | undefined,
  snapshot: RouteSnapshot,
): Promise<boolean> {
  if (!virtualModel.enabled) return false;
  const chain = await buildVirtualModelChain(virtualModel, defaultTier, {
    isDefaultOverrideAvailable: (route) => snapshotOverrideAvailable(route, snapshot),
  });
  return (
    chainContextWindow(
      chain.map((entry) => entry.route),
      virtualModel.response_mode,
      snapshot,
    ).kind !== 'empty'
  );
}
