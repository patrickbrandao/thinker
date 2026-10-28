import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ModelRoute } from 'thinker-shared';
import { ERROR_MESSAGE_STATUSES } from '../analytics/services/query-helpers';

export const TOPOLOGY_RANGES = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 } as const;
export type TopologyRange = keyof typeof TOPOLOGY_RANGES;

export interface Usage {
  requests: number;
  errors: number;
  costUsd: number;
  tokens: number;
}

export interface TopologyHarness extends Usage {
  id: string;
  name: string;
  displayName: string | null;
  platform: string | null;
}

export type HubKind = 'auto' | 'virtual' | 'header';

export interface TopologyHub extends Usage {
  id: string;
  kind: HubKind;
  agentId: string;
  agentName: string;
  name: string;
  enabled: boolean;
}

export interface TopologyProvider extends Usage {
  id: string;
  provider: string;
  authType: string;
  /** Display name (custom providers have one; others repeat `provider`). */
  name: string;
  connections: Array<{ id: string; label: string; active: boolean }>;
  /** Distinct models routed or used through this provider. */
  models: string[];
}

export type LinkKind = 'entry' | 'primary' | 'fallback' | 'usage';

export interface TopologyLink {
  source: string;
  target: string;
  kind: LinkKind;
  requests: number;
  errors: number;
}

export interface Topology {
  range: TopologyRange;
  harnesses: TopologyHarness[];
  hubs: TopologyHub[];
  providers: TopologyProvider[];
  links: TopologyLink[];
}

const CUSTOM_PREFIX = 'custom:';
const zero = (): Usage => ({ requests: 0, errors: 0, costUsd: 0, tokens: 0 });

export const harnessNodeId = (agentId: string) => `harness:${agentId}`;
export const autoHubId = (agentId: string) => `auto:${agentId}`;
export const virtualHubId = (id: string) => `virtual:${id}`;
export const headerHubId = (id: string) => `header:${id}`;
export const providerNodeId = (provider: string, authType: string | null) =>
  `provider:${provider.toLowerCase()}:${authType ?? 'api_key'}`;

interface RouteRow {
  agent_id: string;
  hub_id: string | null;
  override_route: ModelRoute | null;
  auto_assigned_route: ModelRoute | null;
  fallback_routes: ModelRoute[] | null;
}

interface UsageRow {
  agent_id: string;
  virtual_model_id: string | null;
  header_tier_id: string | null;
  provider: string | null;
  auth_type: string | null;
  model: string | null;
  attempts: number;
  requests: number;
  errors: number;
  cost: string | number | null;
  tokens: string | number | null;
}

/**
 * Builds the topology view of the active organization: harnesses, their
 * routing points (auto, virtual models, header tiers), the providers their
 * routes reach, and the traffic of the chosen window on every link. Scoped to
 * one tenant; the playground agent is left out.
 */
@Injectable()
export class TopologyService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async build(tenantId: string, range: TopologyRange): Promise<Topology> {
    const hours = TOPOLOGY_RANGES[range];
    const [agents, tiers, specificity, virtuals, headers, connections, customs, usage] =
      await Promise.all([
        this.ds.query(
          `SELECT id, name, display_name, agent_platform
             FROM agents
            WHERE tenant_id = $1 AND deleted_at IS NULL AND is_playground = false
            ORDER BY name`,
          [tenantId],
        ) as Promise<
          Array<{
            id: string;
            name: string;
            display_name: string | null;
            agent_platform: string | null;
          }>
        >,
        this.ds.query(
          `SELECT t.agent_id, NULL AS hub_id, t.override_route, t.auto_assigned_route,
                  t.fallback_routes
             FROM tier_assignments t JOIN agents a ON a.id = t.agent_id
            WHERE a.tenant_id = $1 AND a.deleted_at IS NULL`,
          [tenantId],
        ) as Promise<RouteRow[]>,
        this.ds.query(
          `SELECT s.agent_id, NULL AS hub_id, s.override_route, s.auto_assigned_route,
                  s.fallback_routes
             FROM specificity_assignments s JOIN agents a ON a.id = s.agent_id
            WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND s.is_active = true`,
          [tenantId],
        ) as Promise<RouteRow[]>,
        this.ds.query(
          `SELECT id, agent_id, name, enabled, override_route, fallback_routes,
                  NULL AS auto_assigned_route
             FROM virtual_models WHERE tenant_id = $1 ORDER BY sort_order, name`,
          [tenantId],
        ) as Promise<Array<RouteRow & { id: string; name: string; enabled: boolean }>>,
        this.ds.query(
          `SELECT id, agent_id, name, enabled, override_route, fallback_routes,
                  NULL AS auto_assigned_route
             FROM header_tiers WHERE tenant_id = $1 ORDER BY sort_order, name`,
          [tenantId],
        ) as Promise<Array<RouteRow & { id: string; name: string; enabled: boolean }>>,
        this.ds.query(
          `SELECT id, provider, auth_type, label, is_active
             FROM tenant_providers WHERE tenant_id = $1 ORDER BY provider, priority, label`,
          [tenantId],
        ) as Promise<
          Array<{
            id: string;
            provider: string;
            auth_type: string | null;
            label: string;
            is_active: boolean;
          }>
        >,
        this.ds.query(`SELECT id, name FROM custom_providers WHERE tenant_id = $1`, [
          tenantId,
        ]) as Promise<Array<{ id: string; name: string }>>,
        this.ds.query(
          `SELECT agent_id, virtual_model_id, header_tier_id, provider, auth_type, model,
                  count(*)::int AS attempts,
                  count(*) FILTER (WHERE superseded = false)::int AS requests,
                  count(*) FILTER (WHERE status = ANY($3))::int AS errors,
                  COALESCE(sum(cost_usd), 0) AS cost,
                  COALESCE(sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
             FROM agent_messages
            WHERE tenant_id = $1 AND agent_id IS NOT NULL
              AND timestamp >= now() - make_interval(hours => $2)
            GROUP BY agent_id, virtual_model_id, header_tier_id, provider, auth_type, model`,
          [tenantId, hours, [...ERROR_MESSAGE_STATUSES]],
        ) as Promise<UsageRow[]>,
      ]);

    const customNames = new Map(customs.map((c) => [`${CUSTOM_PREFIX}${c.id}`, c.name]));
    const agentIds = new Set(agents.map((a) => a.id));

    const harnesses = new Map<string, TopologyHarness>();
    const hubs = new Map<string, TopologyHub>();
    for (const a of agents) {
      harnesses.set(harnessNodeId(a.id), {
        id: harnessNodeId(a.id),
        name: a.name,
        displayName: a.display_name,
        platform: a.agent_platform,
        ...zero(),
      });
      hubs.set(autoHubId(a.id), {
        id: autoHubId(a.id),
        kind: 'auto',
        agentId: a.id,
        agentName: a.name,
        name: 'auto',
        enabled: true,
        ...zero(),
      });
    }
    const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? '';
    for (const [rows, kind, idOf] of [
      [virtuals, 'virtual', virtualHubId],
      [headers, 'header', headerHubId],
    ] as const) {
      for (const row of rows) {
        if (!agentIds.has(row.agent_id)) continue;
        hubs.set(idOf(row.id), {
          id: idOf(row.id),
          kind,
          agentId: row.agent_id,
          agentName: agentName(row.agent_id),
          name: row.name,
          enabled: row.enabled,
          ...zero(),
        });
      }
    }

    const providers = new Map<string, TopologyProvider>();
    const providerModels = new Map<string, Set<string>>();
    const ensureProvider = (provider: string, authType: string | null): TopologyProvider => {
      const id = providerNodeId(provider, authType);
      let node = providers.get(id);
      if (!node) {
        node = {
          id,
          provider,
          authType: authType ?? 'api_key',
          name: customNames.get(provider) ?? provider,
          connections: [],
          models: [],
          ...zero(),
        };
        providers.set(id, node);
        providerModels.set(id, new Set());
      }
      return node;
    };
    for (const c of connections) {
      ensureProvider(c.provider, c.auth_type).connections.push({
        id: c.id,
        label: c.label,
        active: c.is_active,
      });
    }

    const links = new Map<string, TopologyLink>();
    const link = (source: string, target: string, kind: LinkKind): TopologyLink => {
      const key = `${source}>${target}`;
      let edge = links.get(key);
      if (!edge) {
        edge = { source, target, kind, requests: 0, errors: 0 };
        links.set(key, edge);
      } else if (kind === 'primary' || (kind === 'fallback' && edge.kind === 'usage')) {
        edge.kind = kind;
      }
      return edge;
    };

    // Configured routes.
    const addRoutes = (hubId: string, row: RouteRow) => {
      const primary = row.override_route ?? row.auto_assigned_route;
      const routes: Array<[ModelRoute, LinkKind]> = [
        ...(primary ? [[primary, 'primary'] as [ModelRoute, LinkKind]] : []),
        ...(row.fallback_routes ?? []).map((r) => [r, 'fallback'] as [ModelRoute, LinkKind]),
      ];
      for (const [route, kind] of routes) {
        if (!route?.provider || !route.model) continue;
        const provider = ensureProvider(route.provider, route.authType);
        providerModels.get(provider.id)!.add(route.model);
        link(hubId, provider.id, kind);
      }
    };
    for (const row of [...tiers, ...specificity]) {
      if (agentIds.has(row.agent_id)) addRoutes(autoHubId(row.agent_id), row);
    }
    for (const row of virtuals)
      if (hubs.has(virtualHubId(row.id))) addRoutes(virtualHubId(row.id), row);
    for (const row of headers)
      if (hubs.has(headerHubId(row.id))) addRoutes(headerHubId(row.id), row);
    for (const hub of hubs.values()) link(harnessNodeId(hub.agentId), hub.id, 'entry');

    // Traffic of the window.
    for (const row of usage) {
      const harness = harnesses.get(harnessNodeId(row.agent_id));
      if (!harness) continue;
      const hubId =
        (row.virtual_model_id && hubs.has(virtualHubId(row.virtual_model_id))
          ? virtualHubId(row.virtual_model_id)
          : null) ??
        (row.header_tier_id && hubs.has(headerHubId(row.header_tier_id))
          ? headerHubId(row.header_tier_id)
          : null) ??
        autoHubId(row.agent_id);
      const hub = hubs.get(hubId)!;
      const cost = Number(row.cost) || 0;
      const tokens = Number(row.tokens) || 0;
      for (const target of [harness, hub]) {
        target.requests += row.requests;
        target.errors += row.errors;
        target.costUsd += cost;
        target.tokens += tokens;
      }
      const entry = link(harness.id, hubId, 'entry');
      entry.requests += row.requests;
      entry.errors += row.errors;
      if (!row.provider) continue;
      const provider = ensureProvider(row.provider, row.auth_type);
      if (row.model) providerModels.get(provider.id)!.add(row.model);
      provider.requests += row.attempts;
      provider.errors += row.errors;
      provider.costUsd += cost;
      provider.tokens += tokens;
      const edge = link(hubId, provider.id, 'usage');
      edge.requests += row.attempts;
      edge.errors += row.errors;
    }

    // Providers nothing routes to and nothing used stay out of the picture.
    const reached = new Set([...links.values()].map((l) => l.target));
    const providerList = [...providers.values()]
      .filter((p) => reached.has(p.id) || p.connections.length > 0)
      .map((p) => ({ ...p, models: [...providerModels.get(p.id)!].sort() }));

    return {
      range,
      harnesses: [...harnesses.values()],
      hubs: [...hubs.values()],
      providers: providerList,
      links: [...links.values()],
    };
  }
}
