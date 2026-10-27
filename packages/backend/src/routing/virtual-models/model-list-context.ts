import { DEFAULT_TIER_SLOT, TIER_SLOTS, type ModelRoute } from 'thinker-shared';
import type { TierAssignment } from '../../entities/tier-assignment.entity';
import type { SpecificityAssignment } from '../../entities/specificity-assignment.entity';
import { readFallbackRoutes, readOverrideRoute } from '../routing-core/route-helpers';
import {
  chainContextWindow,
  snapshotOverrideAvailable,
  tierChainRoutes,
  type ChainContextWindow,
  type RouteSnapshot,
} from './virtual-model-chain';

export type TierContextSource = Pick<
  TierAssignment,
  'tier' | 'override_route' | 'auto_assigned_route' | 'fallback_routes' | 'response_mode'
>;

export type SpecificityContextSource = Pick<
  SpecificityAssignment,
  'override_route' | 'fallback_routes' | 'response_mode'
>;

/**
 * Context window of one tier slot, from a route snapshot: the chain
 * ResolveService.buildResolvedRouteChain would build for it (override and its
 * fallbacks, or the legacy auto-assigned route when there is no usable
 * override), filtered with the slot's own response mode, as resolveForTier
 * does.
 */
export function tierContextWindow(
  tier: TierContextSource,
  snapshot: RouteSnapshot,
): ChainContextWindow {
  const override = readOverrideRoute(tier);
  const overrideAvailable = override ? snapshotOverrideAvailable(override, snapshot) : false;
  return chainContextWindow(tierChainRoutes(tier, overrideAvailable), tier.response_mode, snapshot);
}

/**
 * Context window of an active specificity assignment. The resolver only uses
 * one with an available override (otherwise it falls through to the tiers),
 * so a missing or unavailable override is a destination `auto` cannot reach.
 */
export function specificityContextWindow(
  assignment: SpecificityContextSource,
  snapshot: RouteSnapshot,
): ChainContextWindow {
  const override = readOverrideRoute(assignment);
  if (!override || !snapshotOverrideAvailable(override, snapshot)) return { kind: 'empty' };
  const chain: ModelRoute[] = [override, ...(readFallbackRoutes(assignment) ?? [])];
  return chainContextWindow(chain, assignment.response_mode, snapshot);
}

/**
 * The smallest window across destinations `auto` can reach. A destination
 * with no route left is skipped (the resolver falls through to another one,
 * or fails without serving the request); one with an unknown window makes the
 * whole answer unknown. Nothing reachable → unknown too.
 */
function minAcross(windows: readonly ChainContextWindow[]): number | null {
  let min: number | null = null;
  for (const window of windows) {
    if (window.kind === 'unknown') return null;
    if (window.kind === 'known' && (min === null || window.value < min)) min = window.value;
  }
  return min;
}

export interface AutoContextInput {
  complexityRoutingEnabled: boolean;
  tiers: readonly TierContextSource[];
  /** Active specificity assignments; ignored with complexity routing off. */
  specificity: readonly SpecificityContextSource[];
  snapshot: RouteSnapshot;
}

/**
 * ADR 0004, section 7: `context_length` of the `auto` entry of `/v1/models`.
 * - Complexity routing off: the Default tier's chain (legacy auto-assigned
 *   route included).
 * - Complexity routing on: the minimum across every destination `auto` can
 *   reach without a header: the simple, standard, complex, reasoning and
 *   default slots, plus the active specificity assignments. Header tiers stay
 *   out, since they need a header.
 * Null (omitted) when a window is unknown or nothing can serve the request.
 * Context-aware routing (#134) moves a too-large request past routes it
 * overflows, but only when another route fits, so the floor stays the size
 * every route can take. Both read windows through snapshotRouteState.
 */
export function autoContextLength(input: AutoContextInput): number | null {
  const { snapshot } = input;
  if (!input.complexityRoutingEnabled) {
    const defaultTier = input.tiers.find((t) => t.tier === DEFAULT_TIER_SLOT);
    if (!defaultTier) return null;
    const window = tierContextWindow(defaultTier, snapshot);
    return window.kind === 'known' ? window.value : null;
  }

  const slots = new Set<string>(TIER_SLOTS);
  const windows: ChainContextWindow[] = [
    ...input.tiers.filter((t) => slots.has(t.tier)).map((t) => tierContextWindow(t, snapshot)),
    ...input.specificity.map((a) => specificityContextWindow(a, snapshot)),
  ];
  return minAcross(windows);
}
