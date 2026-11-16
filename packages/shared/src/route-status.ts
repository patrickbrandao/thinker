import type { ModelRoute } from './model-route';

/**
 * Status of one route of a chain (virtual model, tier or specificity
 * category), as the API reports it. Two independent facts combine here:
 * - the administrator's choice, stored on the route (`disabled`);
 * - whether the provider still offers the model, computed on every read from
 *   the agent's catalog, so a route goes back to service on its own when the
 *   model reappears ("_oos": out of service).
 */
export const ROUTE_STATUSES = ['active', 'active_oos', 'disabled', 'disabled_oos'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

/**
 * Why a route is out of service:
 * - `model_missing`: the connection lists models, but not this one;
 * - `provider_unavailable`: the agent has no usable connection for the
 *   route's provider (disconnected, disabled for the agent, or Qwen/Alibaba
 *   with a cold catalog).
 */
export type RouteOutOfServiceReason = 'model_missing' | 'provider_unavailable';

export interface RouteStatusInfo {
  status: RouteStatus;
  reason: RouteOutOfServiceReason | null;
}

/** Status of every stored route of one chain, in chain order. */
export interface ChainRouteStatus {
  override: RouteStatusInfo | null;
  fallbacks: RouteStatusInfo[];
}

/** Which chain a route-status change targets. */
export const ROUTE_CHAIN_KINDS = ['virtual_model', 'tier', 'specificity'] as const;
export type RouteChainKind = (typeof ROUTE_CHAIN_KINDS)[number];

/** Body of `PATCH /api/v1/routing/:agentName/route-status`. */
export interface SetRouteDisabledRequest {
  chain: RouteChainKind;
  /** Virtual model id, tier slot or specificity category. */
  key: string;
  /** `primary`, or the 0-based fallback index. */
  position: 'primary' | number;
  disabled: boolean;
}

export function isRouteDisabled(route: Pick<ModelRoute, 'disabled'> | null | undefined): boolean {
  return route?.disabled === true;
}

export function combineRouteStatus(
  disabled: boolean,
  outOfService: RouteOutOfServiceReason | null,
): RouteStatusInfo {
  if (disabled) return { status: outOfService ? 'disabled_oos' : 'disabled', reason: outOfService };
  return { status: outOfService ? 'active_oos' : 'active', reason: outOfService };
}

/**
 * The stored route with the `disabled` flag normalized: present only when
 * true, so routes stay byte-identical to the ones stored before the flag
 * existed.
 */
export function withDisabled<T extends ModelRoute>(route: T, disabled: boolean): T {
  const { disabled: _drop, ...rest } = route;
  return (disabled ? { ...rest, disabled: true } : rest) as T;
}
