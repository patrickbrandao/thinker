import type { FlowEdge, FlowNode, FlowPort, FlowRoute, Graph } from '../components/flow/types.js';
import type { Topology, TopologyLink } from '../services/api/console.js';
import { formatCost, formatNumber } from '../services/formatters.js';
import { PROVIDERS } from '../services/providers.js';
import { t, tMaybe } from '../i18n/index.js';

/** Color slot of each kind of route link (legend and edges). */
const LINK_SLOT: Record<Exclude<TopologyLink['kind'], 'entry' | 'client'>, number> = {
  primary: 1,
  fallback: 2,
  usage: 3,
};

export function topologyPorts(): FlowPort[] {
  return (['primary', 'fallback', 'usage'] as const).map((kind) => ({
    id: kind,
    label: t(`shell.flow.links.${kind}`),
    slot: LINK_SLOT[kind],
  }));
}

function usageMetrics(u: { requests: number; errors: number; costUsd?: number }): string[] {
  if (u.requests === 0) return [];
  const lines = [t('shell.flow.metrics.requests', formatNumber(u.requests))];
  if (u.errors > 0) lines.push(t('shell.flow.metrics.errors', formatNumber(u.errors)));
  if (u.costUsd && u.costUsd > 0) lines.push(formatCost(u.costUsd) ?? '');
  return lines.filter(Boolean);
}

const harnessHref = (name: string, sub = '') => `/harnesses/${encodeURIComponent(name)}${sub}`;

const providerName = (provider: string, fallback: string) =>
  PROVIDERS.find((p) => p.id === provider.toLowerCase())?.name ?? fallback;

const ROUTE_ORDER = { primary: 0, fallback: 1, usage: 2 } as const;

/** Handle of a routing point for one final model (and the provider serving it). */
const routeHandle = (l: TopologyLink) => `route:${l.target}>${l.model ?? ''}`;
const isRoute = (l: TopologyLink) => l.kind !== 'entry' && l.kind !== 'client';

/**
 * Turns the topology API payload into a flow graph:
 * client address → harness (entry) → routing point (hub: auto, virtual model)
 * → provider (item, or group when it has several connections). A routing
 * point has one output handle per final model, linked to its provider.
 * With `activeOnly`, nodes and links without traffic in the window are left
 * out (a harness stays when any of its routes carried traffic).
 */
export function buildTopologyGraph(data: Topology, options: { activeOnly?: boolean } = {}): Graph {
  const links = options.activeOnly ? data.links.filter((l) => l.requests > 0) : data.links;
  const used = new Set(links.flatMap((l) => [l.source, l.target]));
  const keep = (id: string) => !options.activeOnly || used.has(id);

  const providerIds = new Set(data.providers.filter((p) => keep(p.id)).map((p) => p.id));
  const routesOf = new Map<string, TopologyLink[]>();
  for (const l of links) {
    if (!isRoute(l) || !providerIds.has(l.target)) continue;
    routesOf.set(l.source, [...(routesOf.get(l.source) ?? []), l]);
  }
  const called = new Set(links.filter((l) => l.kind === 'client').map((l) => l.target));

  const nodes: FlowNode[] = [];
  for (const c of data.clients ?? []) {
    nodes.push({
      id: c.id,
      type: 'client',
      position: { x: 0, y: 0 },
      data: { kind: 'client', title: c.ip, count: c.requests },
    });
  }
  for (const h of data.harnesses) {
    if (!keep(h.id)) continue;
    nodes.push({
      id: h.id,
      type: 'entry',
      position: { x: 0, y: 0 },
      data: {
        kind: 'entry',
        inbound: called.has(h.id),
        title: h.displayName || h.name,
        subtitle: h.platform,
        metrics: usageMetrics(h),
        href: harnessHref(h.name),
      },
    });
  }
  // Routing points sit next to their harness, so the canvas rows line up.
  const harnessOrder = new Map(data.harnesses.map((h, i) => [h.id.slice('harness:'.length), i]));
  const hubs = [...data.hubs].sort(
    (a, b) => (harnessOrder.get(a.agentId) ?? 0) - (harnessOrder.get(b.agentId) ?? 0),
  );
  for (const hub of hubs) {
    if (!keep(hub.id)) continue;
    const routes: FlowRoute[] = [...(routesOf.get(hub.id) ?? [])]
      .sort(
        (a, b) =>
          ROUTE_ORDER[a.kind as keyof typeof ROUTE_ORDER] -
          ROUTE_ORDER[b.kind as keyof typeof ROUTE_ORDER],
      )
      .map((l) => ({
        id: routeHandle(l),
        label: l.model ?? l.target,
        port: LINK_SLOT[l.kind as keyof typeof LINK_SLOT],
      }));
    nodes.push({
      id: hub.id,
      type: 'hub',
      position: { x: 0, y: 0 },
      data: {
        kind: 'hub',
        label: t('shell.flow.hubs.virtual'),
        title: hub.name,
        subtitle: hub.enabled ? null : t('shell.flow.disabled'),
        routes,
        metrics: usageMetrics(hub),
        href: harnessHref(hub.agentName, '/routing'),
      },
    });
  }
  for (const p of data.providers) {
    if (!keep(p.id)) continue;
    const pooled = p.connections.length > 1;
    const single = p.connections.length === 1 ? p.connections[0] : null;
    nodes.push({
      id: p.id,
      type: pooled ? 'group' : 'item',
      position: { x: 0, y: 0 },
      data: {
        kind: pooled ? 'group' : 'item',
        title: providerName(p.provider, p.name),
        subtitle: [
          tMaybe(`shell.flow.auth.${p.authType}`) ?? p.authType,
          p.connections.length === 0 ? t('shell.flow.notConnected') : null,
          p.models.length ? t('shell.flow.models', p.models.length) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        count: pooled ? p.connections.length : undefined,
        metrics: usageMetrics(p),
        href: single
          ? `/providers/connections/${encodeURIComponent(single.id)}`
          : p.authType === 'subscription'
            ? '/providers/subscriptions'
            : p.authType === 'local'
              ? '/providers/local'
              : '/providers/usage-based',
      },
    });
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = links
    .filter((l) => ids.has(l.source) && ids.has(l.target))
    .map((l) => ({
      id: l.model ? `${l.source}>${l.target}>${l.model}` : `${l.source}>${l.target}`,
      source: l.source,
      target: l.target,
      ...(isRoute(l) ? { sourceHandle: routeHandle(l) } : {}),
      data: {
        port: isRoute(l) ? LINK_SLOT[l.kind as keyof typeof LINK_SLOT] : undefined,
        live: l.requests,
        // The client node already shows its count.
        label: l.requests > 0 && l.kind !== 'client' ? formatNumber(l.requests) : undefined,
        state: l.requests > 0 && l.errors * 2 >= l.requests ? 'error' : undefined,
      },
    }));
  return { nodes, edges };
}
