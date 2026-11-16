import { fetchMutate, routingPath } from './core.js';
import type { ChainRouteStatus, RouteStatusInfo, SetRouteDisabledRequest } from 'thinker-shared';

export type { ChainRouteStatus, RouteStatusInfo, SetRouteDisabledRequest };

/** Fired on `window` after a route is disabled or re-enabled, so routing views reload. */
export const ROUTE_STATUS_CHANGED_EVENT = 'thinker:route-status-changed';

/** Disables or re-enables one route of a virtual model, tier or category chain. */
export async function setRouteDisabled(agentName: string, body: SetRouteDisabledRequest) {
  const res = await fetchMutate<{ ok: true }>(routingPath(agentName, 'route-status'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  window.dispatchEvent(new Event(ROUTE_STATUS_CHANGED_EVENT));
  return res;
}

/** Whether any stored route of the chain can serve right now. */
export function chainHasServingRoute(status: ChainRouteStatus | undefined): boolean | undefined {
  if (!status) return undefined;
  const all = [...(status.override ? [status.override] : []), ...status.fallbacks];
  if (all.length === 0) return undefined;
  return all.some((s) => s.status === 'active');
}
