import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ModelRoute } from 'thinker-shared';
import { ERROR_MESSAGE_STATUSES } from '../analytics/services/query-helpers';
import { getGlobalProxyConfig } from '../common/outbound/outbound-proxy';
import { authKindOf, defaultTargetOf } from '../proxy-servers/proxy-egress.service';

export const TOPOLOGY_RANGES = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 } as const;
export type TopologyRange = keyof typeof TOPOLOGY_RANGES;

export interface Usage {
  requests: number;
  errors: number;
  costUsd: number;
  tokens: number;
}

/** A client address that called a harness in the window. */
export interface TopologyClient {
  id: string;
  ip: string;
  requests: number;
  errors: number;
}

export interface TopologyHarness extends Usage {
  id: string;
  name: string;
  displayName: string | null;
  platform: string | null;
}

/** A provider connection (API key, subscription or local server). */
export interface TopologyProvider extends Usage {
  id: string;
  connectionId: string;
  provider: string;
  authType: string;
  /** Display name (custom providers have one; others repeat `provider`). */
  name: string;
  label: string;
  active: boolean;
}

/** An outbound proxy profile, or the global proxy of the environment (`profileId` null). */
export interface TopologyProxy extends Usage {
  id: string;
  profileId: string | null;
  name: string;
}

/** Where traffic finally leaves: the internet or the local network (local servers). */
export interface TopologyEgress extends Usage {
  id: 'internet' | 'local';
}

export type LinkKind = 'client' | 'primary' | 'fallback' | 'usage' | 'egress';

/** A model a harness reaches through a provider link (`via`: virtual model, or "auto"). */
export interface TopologyLinkModel {
  via: string;
  model: string;
  kind: 'primary' | 'fallback' | 'usage';
  requests: number;
}

export interface TopologyLink {
  source: string;
  target: string;
  kind: LinkKind;
  requests: number;
  errors: number;
  costUsd: number;
  models?: TopologyLinkModel[];
}

export interface Topology {
  range: TopologyRange;
  clients: TopologyClient[];
  harnesses: TopologyHarness[];
  providers: TopologyProvider[];
  proxies: TopologyProxy[];
  egress: TopologyEgress[];
  links: TopologyLink[];
  /** Positions the user saved on the canvas, by node id. */
  positions: Record<string, { x: number; y: number }>;
}

const CUSTOM_PREFIX = 'custom:';
const zero = (): Usage => ({ requests: 0, errors: 0, costUsd: 0, tokens: 0 });
const add = (target: Usage, u: Usage) => {
  target.requests += u.requests;
  target.errors += u.errors;
  target.costUsd += u.costUsd;
  target.tokens += u.tokens;
};

export const clientNodeId = (ip: string) => `client:${ip}`;
export const harnessNodeId = (agentId: string) => `harness:${agentId}`;
export const connectionNodeId = (id: string) => `connection:${id}`;
export const profileNodeId = (id: string) => `proxy:${id}`;
export const GLOBAL_PROXY_NODE = 'proxy:global';

/** Link kinds ranked: a link drawn for several reasons takes the strongest. */
const KIND_RANK: Record<LinkKind, number> = {
  primary: 3,
  usage: 2,
  fallback: 1,
  client: 0,
  egress: 0,
};

/** Maximum saved positions per workspace (the canvas sends the moved nodes only). */
export const MAX_POSITIONS = 2_000;

interface RouteRow {
  id: string;
  agent_id: string;
  name: string;
  enabled: boolean;
  override_route: ModelRoute | null;
  fallback_routes: ModelRoute[] | null;
}

interface ConnectionRow {
  id: string;
  provider: string;
  auth_type: string | null;
  label: string;
  is_active: boolean;
}

interface UsageRow {
  agent_id: string;
  virtual_model_id: string | null;
  tenant_provider_id: string | null;
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
 * Builds the topology of the active organization as the path a request takes:
 * client address → harness → provider connection → outbound proxy profile →
 * internet (or the local network for local servers). Harnesses link to the
 * connections that serve their virtual models (primary and fallbacks); other
 * routes (auto) show only when they carried traffic in the window. Scoped to
 * one tenant; the playground agent is left out.
 */
@Injectable()
export class TopologyService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async build(tenantId: string, range: TopologyRange): Promise<Topology> {
    const hours = TOPOLOGY_RANGES[range];
    const [agents, virtuals, connections, customs, profiles, assignments, usage, callers, saved] =
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
          `SELECT id, agent_id, name, enabled, override_route, fallback_routes
             FROM virtual_models WHERE tenant_id = $1 ORDER BY sort_order, name`,
          [tenantId],
        ) as Promise<RouteRow[]>,
        this.ds.query(
          `SELECT id, provider, auth_type, label, is_active
             FROM tenant_providers WHERE tenant_id = $1 ORDER BY provider, priority, label`,
          [tenantId],
        ) as Promise<ConnectionRow[]>,
        this.ds.query(`SELECT id, name, local_type FROM custom_providers WHERE tenant_id = $1`, [
          tenantId,
        ]) as Promise<Array<{ id: string; name: string; local_type: string | null }>>,
        this.ds.query(
          `SELECT p.id, p.name,
                  EXISTS (SELECT 1 FROM proxy_bindings b
                           WHERE b.tenant_id = p.tenant_id AND b.target_type = 'profile'
                             AND b.target_id = p.id) AS has_items
             FROM proxy_profiles p WHERE p.tenant_id = $1`,
          [tenantId],
        ) as Promise<Array<{ id: string; name: string; has_items: boolean }>>,
        this.ds.query(
          `SELECT target_type, target_id, mode, profile_id FROM proxy_assignments
            WHERE tenant_id = $1 AND target_type IN ('provider', 'connection')`,
          [tenantId],
        ) as Promise<
          Array<{ target_type: string; target_id: string; mode: string; profile_id: string | null }>
        >,
        this.ds.query(
          `SELECT agent_id, virtual_model_id, tenant_provider_id, provider, auth_type, model,
                  count(*)::int AS attempts,
                  count(*) FILTER (WHERE superseded = false)::int AS requests,
                  count(*) FILTER (WHERE status = ANY($3))::int AS errors,
                  COALESCE(sum(cost_usd), 0) AS cost,
                  COALESCE(sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
             FROM agent_messages
            WHERE tenant_id = $1 AND agent_id IS NOT NULL
              AND timestamp >= now() - make_interval(hours => $2)
            GROUP BY agent_id, virtual_model_id, tenant_provider_id, provider, auth_type, model`,
          [tenantId, hours, [...ERROR_MESSAGE_STATUSES]],
        ) as Promise<UsageRow[]>,
        // The proxy stamps the client address into caller_attribution (JSON text).
        this.ds.query(
          `SELECT agent_id, ip,
                  count(*) FILTER (WHERE superseded = false)::int AS requests,
                  count(*) FILTER (WHERE status = ANY($3) AND superseded = false)::int AS errors
             FROM (SELECT agent_id, superseded, status,
                          substring(caller_attribution from '"clientIp":"([^"]+)"') AS ip
                     FROM agent_messages
                    WHERE tenant_id = $1 AND agent_id IS NOT NULL
                      AND timestamp >= now() - make_interval(hours => $2)) m
            WHERE ip IS NOT NULL
            GROUP BY agent_id, ip`,
          [tenantId, hours, [...ERROR_MESSAGE_STATUSES]],
        ) as Promise<Array<{ agent_id: string; ip: string; requests: number; errors: number }>>,
        this.ds.query(`SELECT node_id, x, y FROM topology_positions WHERE tenant_id = $1`, [
          tenantId,
        ]) as Promise<Array<{ node_id: string; x: number; y: number }>>,
      ]);

    const customById = new Map(customs.map((c) => [`${CUSTOM_PREFIX}${c.id}`.toLowerCase(), c]));
    const harnesses = new Map<string, TopologyHarness>();
    for (const a of agents) {
      harnesses.set(harnessNodeId(a.id), {
        id: harnessNodeId(a.id),
        name: a.name,
        displayName: a.display_name,
        platform: a.agent_platform,
        ...zero(),
      });
    }
    const virtualNames = new Map(virtuals.map((v) => [v.id, v.name]));

    const providers = new Map<string, TopologyProvider>();
    for (const c of connections) {
      providers.set(connectionNodeId(c.id), {
        id: connectionNodeId(c.id),
        connectionId: c.id,
        provider: c.provider,
        authType: c.auth_type ?? 'api_key',
        name: customById.get(c.provider.toLowerCase())?.name ?? c.provider,
        label: c.label,
        active: c.is_active,
        ...zero(),
      });
    }
    const sameProvider = (p: TopologyProvider, provider: string, authType: string | null) =>
      p.provider.toLowerCase() === provider.toLowerCase() && p.authType === (authType ?? 'api_key');
    /** Connections a configured route can use: the pinned one, else every active one. */
    const connectionsOf = (route: ModelRoute): TopologyProvider[] => {
      const all = [...providers.values()].filter((p) =>
        sameProvider(p, route.provider, route.authType),
      );
      if (route.keyLabel) {
        const pinned = all.filter((p) => p.label === route.keyLabel);
        if (pinned.length) return pinned;
      }
      const active = all.filter((p) => p.active);
      return active.length ? active : all;
    };

    const links = new Map<string, TopologyLink>();
    const link = (source: string, target: string, kind: LinkKind): TopologyLink => {
      const key = `${source}>${target}`;
      let edge = links.get(key);
      if (!edge) {
        edge = { source, target, kind, requests: 0, errors: 0, costUsd: 0 };
        links.set(key, edge);
      } else if (KIND_RANK[kind] > KIND_RANK[edge.kind]) {
        edge.kind = kind;
      }
      return edge;
    };
    const addModel = (
      edge: TopologyLink,
      via: string,
      model: string,
      kind: TopologyLinkModel['kind'],
      requests = 0,
    ) => {
      edge.models ??= [];
      const known = edge.models.find((m) => m.via === via && m.model === model);
      if (known) {
        known.requests += requests;
        if (KIND_RANK[kind] > KIND_RANK[known.kind]) known.kind = kind;
      } else {
        edge.models.push({ via, model, kind, requests });
      }
    };

    // Configured routes of the virtual models.
    for (const v of virtuals) {
      const harnessId = harnessNodeId(v.agent_id);
      if (!harnesses.has(harnessId) || !v.enabled) continue;
      const routes: Array<[ModelRoute, 'primary' | 'fallback']> = [
        ...(v.override_route ? [[v.override_route, 'primary'] as [ModelRoute, 'primary']] : []),
        ...(v.fallback_routes ?? []).map((r) => [r, 'fallback'] as [ModelRoute, 'fallback']),
      ];
      for (const [route, kind] of routes) {
        if (!route?.provider || !route.model) continue;
        for (const p of connectionsOf(route)) {
          addModel(link(harnessId, p.id, kind), v.name, route.model, kind);
        }
      }
    }

    // Traffic of the window; a row without a connection falls on the first match.
    for (const row of usage) {
      const harness = harnesses.get(harnessNodeId(row.agent_id));
      if (!harness) continue;
      const u: Usage = {
        requests: row.requests,
        errors: row.errors,
        costUsd: Number(row.cost) || 0,
        tokens: Number(row.tokens) || 0,
      };
      add(harness, u);
      if (!row.provider) continue;
      const provider =
        (row.tenant_provider_id ? providers.get(connectionNodeId(row.tenant_provider_id)) : null) ??
        connectionsOf({
          provider: row.provider,
          authType: row.auth_type,
          model: '',
        } as ModelRoute)[0];
      if (!provider) continue;
      add(provider, { ...u, requests: row.attempts });
      const edge = link(harness.id, provider.id, 'usage');
      edge.requests += row.attempts;
      edge.errors += row.errors;
      edge.costUsd += u.costUsd;
      const via = (row.virtual_model_id && virtualNames.get(row.virtual_model_id)) || 'auto';
      if (row.model) addModel(edge, via, row.model, 'usage', row.attempts);
    }

    // Client addresses, each linked to the harnesses it called.
    const clients = new Map<string, TopologyClient>();
    for (const row of callers) {
      if (!harnesses.has(harnessNodeId(row.agent_id))) continue;
      const id = clientNodeId(row.ip);
      const client = clients.get(id) ?? { id, ip: row.ip, requests: 0, errors: 0 };
      client.requests += row.requests;
      client.errors += row.errors;
      clients.set(id, client);
      const edge = link(id, harnessNodeId(row.agent_id), 'client');
      edge.requests += row.requests;
      edge.errors += row.errors;
    }

    // Only connections a harness reaches stay; each one leads to its egress.
    const reached = new Set([...links.values()].map((l) => l.target));
    const providerList = [...providers.values()].filter((p) => reached.has(p.id));

    const assigned = new Map(assignments.map((a) => [`${a.target_type}:${a.target_id}`, a]));
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const globalProxy = getGlobalProxyConfig() !== null;
    const proxies = new Map<string, TopologyProxy>();
    const egress = new Map<string, TopologyEgress>();
    const flow = (source: string, target: string, from: Usage) => {
      const edge = link(source, target, 'egress');
      edge.requests += from.requests;
      edge.errors += from.errors;
      edge.costUsd += from.costUsd;
    };
    const reach = (id: 'internet' | 'local', from: Usage) => {
      const node = egress.get(id) ?? { id, ...zero() };
      add(node, from);
      egress.set(id, node);
    };
    for (const p of providerList) {
      const kind = authKindOf(p.authType);
      const localType = customById.get(p.provider.toLowerCase())?.local_type ?? null;
      const target = defaultTargetOf(kind, p.provider, localType);
      const assignment =
        assigned.get(`connection:${p.connectionId}`) ?? assigned.get(`provider:${target}`);
      const profile =
        assignment?.mode === 'profile' && assignment.profile_id
          ? profileById.get(assignment.profile_id)
          : undefined;
      // An empty profile and "global" both fall back to the global proxy, which
      // local servers never use.
      const proxyId = profile?.has_items
        ? profileNodeId(profile.id)
        : assignment?.mode !== 'direct' && globalProxy && kind !== 'local'
          ? GLOBAL_PROXY_NODE
          : null;
      const end = kind === 'local' ? 'local' : 'internet';
      if (!proxyId) {
        flow(p.id, end, p);
        reach(end, p);
        continue;
      }
      const proxy = proxies.get(proxyId) ?? {
        id: proxyId,
        profileId: profile?.has_items ? profile.id : null,
        name: profile?.has_items ? profile.name : 'Global',
        ...zero(),
      };
      add(proxy, p);
      proxies.set(proxyId, proxy);
      flow(p.id, proxyId, p);
    }
    for (const proxy of proxies.values()) {
      flow(proxy.id, 'internet', proxy);
      reach('internet', proxy);
    }

    return {
      range,
      clients: [...clients.values()].sort((a, b) => b.requests - a.requests),
      harnesses: [...harnesses.values()],
      providers: providerList,
      proxies: [...proxies.values()].sort((a, b) => a.name.localeCompare(b.name)),
      egress: [...egress.values()],
      links: [...links.values()],
      positions: Object.fromEntries(saved.map((r) => [r.node_id, { x: r.x, y: r.y }])),
    };
  }

  /** Saves the positions of moved nodes (upsert). */
  async savePositions(
    tenantId: string,
    positions: Array<{ id: string; x: number; y: number }>,
  ): Promise<void> {
    const valid = positions
      .filter(
        (p) =>
          typeof p?.id === 'string' &&
          p.id.length > 0 &&
          p.id.length <= 300 &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.y),
      )
      .slice(0, MAX_POSITIONS);
    if (valid.length === 0) return;
    await this.ds.query(
      `INSERT INTO topology_positions (tenant_id, node_id, x, y, updated_at)
       SELECT $1, p.id, p.x, p.y, now()
         FROM jsonb_to_recordset($2::jsonb) AS p(id varchar, x integer, y integer)
       ON CONFLICT (tenant_id, node_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y,
         updated_at = now()`,
      [
        tenantId,
        JSON.stringify(valid.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y) }))),
      ],
    );
  }

  /** Drops every saved position, so the canvas goes back to the column layout. */
  async resetPositions(tenantId: string): Promise<void> {
    await this.ds.query(`DELETE FROM topology_positions WHERE tenant_id = $1`, [tenantId]);
  }
}
