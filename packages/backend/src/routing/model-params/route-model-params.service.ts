import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  deleteProviderParamValue,
  getProviderParamValue,
  isProviderParamPath,
  modelParamsScopeForHeaderTier,
  modelParamsScopeForTier,
  modelParamsScopeForVirtualModel,
  setProviderParamValue,
  type AuthType,
  type JsonValue,
  type ModelParamDefinition,
  type ModelRoute,
  type ProviderParamSpec,
  type RequestParamDefaults,
} from 'thinker-shared';
import { TierService } from '../routing-core/tier.service';
import { HeaderTierService } from '../header-tiers/header-tier.service';
import { VirtualModelService } from '../virtual-models/virtual-model.service';
import { AgentModelParamsService } from '../routing-core/agent-model-params.service';
import { ProviderParamSpecService } from '../routing-core/provider-param-spec.service';
import {
  effectiveRoute,
  readFallbackRoutes,
  readOverrideRoute,
} from '../routing-core/route-helpers';
import { normalizeProviderModel } from '../../common/utils/anthropic-model-id';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { openAiModelId } from '../routing-core/public-model-id';
import { sanitizeModelParams } from './sanitize-model-params';

export const DEFAULT_TIER_NAME = 'default';

export interface RouteModelParamsChange {
  set?: Record<string, JsonValue>;
  unset?: string[];
}

export interface RouteModelParamView extends ModelParamDefinition {
  /** Saved value, or null when the provider's own default applies. */
  current: JsonValue | null;
}

/**
 * Which route family the params belong to. A tier (`default` or a custom
 * tier's name) and a virtual model are separate selectors: the two live in
 * different tables with no shared name uniqueness, so one name may denote
 * both on the same agent (ADR 0004, section 9).
 */
export type RouteParamsTarget = { tier: string } | { virtual: string };

export interface RouteModelParamsView {
  /** Set when the target is a tier. */
  tier?: string;
  /** Set when the target is a virtual model: its name as stored. */
  virtual?: string;
  route: { provider: string; authType: AuthType; model: string };
  /** The public id of `route` (as `/v1/models` publishes it), e.g. `<alias>/<model>`. */
  public_model: string;
  /** Every model the tier or virtual model routes to, primary first — the valid `model` inputs. */
  models: string[];
  /** The public ids of `models`, in the same order; also valid `model` inputs. */
  public_models: string[];
  params: RouteModelParamView[];
}

interface ResolvedRoute {
  kind: 'tier' | 'virtual';
  /** The tier or virtual model name as stored. */
  name: string;
  scope: string;
  route: ModelRoute;
  /** The id the proxy forwards; specs are catalogued under it (see normalizeProviderModel). */
  paramsModel: string;
  models: string[];
  publicModel: string;
  publicModels: string[];
}

interface RouteFamily {
  kind: 'tier' | 'virtual';
  name: string;
  scope: string;
  primary: ModelRoute | null;
  fallbacks: ModelRoute[];
}

/**
 * The public id of a stored route: `openAiModelId` of its catalog entry
 * (`<alias>/<model>` for an aliased custom provider, `<provider>/<model>`
 * otherwise). A route the catalog no longer lists gets the id derived from
 * the route alone, which is the same except for a custom provider's alias.
 */
function publicModelId(route: ModelRoute, catalog: readonly DiscoveredModel[]): string {
  const provider = route.provider.toLowerCase();
  const entry = catalog.find(
    (m) =>
      m.provider.toLowerCase() === provider &&
      m.authType === route.authType &&
      m.id === route.model,
  );
  return openAiModelId(
    entry ??
      ({ id: route.model, provider: route.provider, authType: route.authType } as DiscoveredModel),
  );
}

/**
 * Names derived from a route's native model id: the id without its provider
 * prefix and `<provider>/<native>` (for a custom provider, the model name
 * after `custom:<id>/`).
 */
function derivedModelNames(route: ModelRoute): Set<string> {
  const provider = route.provider.toLowerCase();
  const names = new Set<string>();
  if (provider.startsWith('custom:')) {
    const prefix = `${route.provider}/`;
    if (route.model.startsWith(prefix)) names.add(route.model.slice(prefix.length));
  } else {
    const native = route.model.toLowerCase().startsWith(`${provider}/`)
      ? route.model.slice(provider.length + 1)
      : route.model;
    names.add(native);
    names.add(`${provider}/${native}`);
  }
  return names;
}

/**
 * The routes a model name selects, in layers: (1) the stored id (Anthropic
 * short ids normalized as before), (2) the public id, (3) the derived native
 * names. The first layer with a match wins, so an id that names one route
 * exactly is never made ambiguous by another route's derived name; only
 * matches within the winning layer can be ambiguous.
 */
function matchRoutes(
  name: string,
  routes: readonly ModelRoute[],
  publicIds: ReadonlyMap<ModelRoute, string>,
): ModelRoute[] {
  const layers: Array<(r: ModelRoute) => boolean> = [
    (r) =>
      r.model === name ||
      normalizeProviderModel(r.provider, r.model) === normalizeProviderModel(r.provider, name),
    (r) => publicIds.get(r) === name,
    (r) => derivedModelNames(r).has(name),
  ];
  for (const layer of layers) {
    const hits = routes.filter(layer);
    if (hits.length > 0) return hits;
  }
  return [];
}

function connectionKey(route: ModelRoute): string {
  return `${route.provider.toLowerCase()}|${route.authType}`;
}

/**
 * Model params addressed the way people name a route: a tier (`default` or a
 * custom tier's name) or a virtual model, plus one of the models it routes
 * to. Resolves that to the stored (scope, provider, authType, model)
 * identity, so the CLI and MCP never handle scope keys or ids. The dashboard
 * keeps using the scope-keyed endpoints; both write the same rows.
 */
@Injectable()
export class RouteModelParamsService {
  constructor(
    private readonly tiers: TierService,
    private readonly headerTiers: HeaderTierService,
    private readonly virtualModels: VirtualModelService,
    private readonly modelParams: AgentModelParamsService,
    private readonly specs: ProviderParamSpecService,
    private readonly discovery: ModelDiscoveryService,
  ) {}

  /**
   * `target` is a tier name (the default tier when omitted) or `{ virtual }`.
   * `model` may be the stored, public or native id of one of the routes.
   * `tenantId` lets public ids of aliased custom providers resolve (they need
   * the agent's catalog); without it only route-derived names match.
   */
  async get(
    agentId: string,
    target: string | RouteParamsTarget = DEFAULT_TIER_NAME,
    model?: string,
    tenantId?: string,
  ): Promise<RouteModelParamsView> {
    const resolved = await this.resolve(agentId, target, model, tenantId);
    const specs = await this.specsFor(resolved);
    return this.view(agentId, resolved, specs);
  }

  async update(
    agentId: string,
    target: string | RouteParamsTarget | undefined,
    model: string | undefined,
    change: RouteModelParamsChange,
    tenantId?: string,
  ): Promise<RouteModelParamsView> {
    const setEntries = Object.entries(change.set ?? {});
    const unset = change.unset ?? [];
    if (setEntries.length === 0 && unset.length === 0) {
      throw new BadRequestException('Nothing to change: pass at least one param to set or unset');
    }

    for (const path of [...unset, ...setEntries.map(([p]) => p)]) {
      if (!isProviderParamPath(path)) throw new BadRequestException(`Invalid param path "${path}"`);
    }

    const resolved = await this.resolve(agentId, target ?? DEFAULT_TIER_NAME, model, tenantId);
    const { route, scope } = resolved;
    const specs = await this.specsFor(resolved);
    const saved = (await this.savedParams(agentId, resolved)) ?? {};

    for (const path of unset) {
      if (!specs.some((s) => s.path === path) && getProviderParamValue(saved, path) === undefined) {
        throw this.unknownParam(path, route.model, specs);
      }
    }
    for (const [path] of setEntries) {
      if (!specs.some((s) => s.path === path)) throw this.unknownParam(path, route.model, specs);
    }

    let next: RequestParamDefaults = saved;
    for (const path of unset) next = deleteProviderParamValue(next, path);
    for (const [path, value] of setEntries) next = setProviderParamValue(next, path, value);

    if (Object.keys(next).length === 0) {
      await this.modelParams.delete(agentId, scope, route.provider, route.authType, route.model);
    } else {
      const sanitized = sanitizeModelParams(route.provider, next, specs);
      for (const [path] of setEntries) {
        if (getProviderParamValue(sanitized, path) === undefined) {
          throw new BadRequestException(
            `Param "${path}" does not apply with the current settings of ${route.model}`,
          );
        }
      }
      await this.modelParams.set(
        agentId,
        scope,
        route.provider,
        route.authType,
        route.model,
        sanitized,
      );
    }
    return this.view(agentId, resolved, specs);
  }

  private async resolve(
    agentId: string,
    target: string | RouteParamsTarget,
    model?: string,
    tenantId?: string,
  ): Promise<ResolvedRoute> {
    const family =
      typeof target === 'string'
        ? await this.findTier(agentId, target)
        : 'virtual' in target
          ? await this.findVirtualModel(agentId, target.virtual)
          : await this.findTier(agentId, target.tier);
    const { kind, name, primary, fallbacks } = family;
    const label = kind === 'virtual' ? `virtual model "${name}"` : `tier "${name}"`;
    const routes = [primary, ...fallbacks].filter((r): r is ModelRoute => r !== null);
    const models = [...new Set(routes.map((r) => r.model))];
    const catalog =
      tenantId && routes.length > 0
        ? await this.discovery.getModelsForAgent(tenantId, agentId).catch(() => [])
        : [];
    const publicIds = new Map(routes.map((r) => [r, publicModelId(r, catalog)]));
    const publicModels = models.map((m) => publicIds.get(routes.find((r) => r.model === m)!) ?? m);
    const ids = { models, publicModels, publicIds };

    if (model === undefined) {
      if (!primary) {
        throw new BadRequestException(
          `${label.charAt(0).toUpperCase()}${label.slice(1)} has no model yet` +
            (kind === 'virtual'
              ? '; routes it borrows from the Default tier take the default tier params'
              : ''),
        );
      }
      return this.resolved(family, primary, ids);
    }

    const matches = matchRoutes(model, routes, publicIds);
    if (matches.length === 0) {
      // A custom provider's stored id is an internal key: show the public
      // id the operator knows next to it.
      const listed = models.map((m, i) =>
        m.startsWith('custom:') && publicModels[i] !== m ? `${m} (${publicModels[i]})` : m,
      );
      throw new BadRequestException(
        `Model "${model}" is not routed by ${label}. Models: ${listed.join(', ')}`,
      );
    }
    const connections = new Set(matches.map(connectionKey));
    if (connections.size > 1) {
      // Suggest, per matched route, a name (public id first, then stored id)
      // that selects that route's connection alone.
      const unique = (name: string, route: ModelRoute) => {
        const hits = new Set(matchRoutes(name, routes, publicIds).map(connectionKey));
        return hits.size === 1 && hits.has(connectionKey(route));
      };
      const options = [
        ...new Set(
          matches
            .map((r) => [publicIds.get(r)!, r.model].find((name) => unique(name, r)))
            .filter((name): name is string => name !== undefined),
        ),
      ];
      throw new BadRequestException(
        `Model "${model}" is routed through more than one connection in ${label}; ` +
          (options.length > 1
            ? `name it by one of: ${options.join(', ')}`
            : options.length === 1
              ? `name it by ${options[0]}`
              : 'set its params from the dashboard'),
      );
    }
    return this.resolved(family, matches[0], ids);
  }

  private resolved(
    family: RouteFamily,
    route: ModelRoute,
    ids: { models: string[]; publicModels: string[]; publicIds: Map<ModelRoute, string> },
  ): ResolvedRoute {
    const paramsModel = normalizeProviderModel(route.provider, route.model);
    return {
      kind: family.kind,
      name: family.name,
      scope: family.scope,
      route,
      paramsModel,
      models: ids.models,
      publicModel: ids.publicIds.get(route) ?? route.model,
      publicModels: ids.publicModels,
    };
  }

  private async findTier(agentId: string, tier: string): Promise<RouteFamily> {
    if (tier.toLowerCase() === DEFAULT_TIER_NAME) {
      const row = (await this.tiers.getTiers(agentId)).find((t) => t.tier === DEFAULT_TIER_NAME);
      if (row) {
        return {
          kind: 'tier',
          name: DEFAULT_TIER_NAME,
          scope: modelParamsScopeForTier(DEFAULT_TIER_NAME),
          primary: effectiveRoute(row),
          fallbacks: readFallbackRoutes(row) ?? [],
        };
      }
    }
    const custom = await this.headerTiers.list(agentId);
    const match = custom.find((t) => t.name.toLowerCase() === tier.toLowerCase());
    if (!match || tier.toLowerCase() === DEFAULT_TIER_NAME) {
      const names = [DEFAULT_TIER_NAME, ...custom.map((t) => t.name)];
      throw new NotFoundException(`Tier "${tier}" not found. Available tiers: ${names.join(', ')}`);
    }
    return {
      kind: 'tier',
      name: match.name,
      scope: modelParamsScopeForHeaderTier(match.id),
      primary: readOverrideRoute(match),
      fallbacks: readFallbackRoutes(match) ?? [],
    };
  }

  /**
   * A virtual model by name, ignoring case like the proxy does. Disabled ones
   * resolve too: their params are configuration, kept for when they are
   * enabled again. Only the virtual model's own chain is addressable here;
   * the routes `continue_on_default` borrows keep the `tier:default` scope
   * and are set through the default tier.
   */
  private async findVirtualModel(agentId: string, virtual: string): Promise<RouteFamily> {
    const rows = await this.virtualModels.list(agentId);
    const wanted = virtual.toLowerCase();
    const match = rows.find((r) => r.name.toLowerCase() === wanted);
    if (!match) {
      const names = rows.map((r) => r.name);
      throw new NotFoundException(
        `Virtual model "${virtual}" not found.` +
          (names.length > 0
            ? ` Available virtual models: ${names.join(', ')}`
            : ' The agent has no virtual models'),
      );
    }
    return {
      kind: 'virtual',
      name: match.name,
      scope: modelParamsScopeForVirtualModel(match.id),
      primary: match.override_route ?? null,
      fallbacks: match.fallback_routes ?? [],
    };
  }

  private specsFor({ route, paramsModel }: ResolvedRoute): Promise<readonly ProviderParamSpec[]> {
    return this.specs.getSpecs(route.provider, route.authType, paramsModel);
  }

  // Saved under the route's model id as configured, the key the dashboard uses too.
  private savedParams(agentId: string, { scope, route }: ResolvedRoute) {
    return this.modelParams.get(agentId, scope, route.provider, route.authType, route.model);
  }

  private async view(
    agentId: string,
    resolved: ResolvedRoute,
    specs: readonly ProviderParamSpec[],
  ): Promise<RouteModelParamsView> {
    const saved = await this.savedParams(agentId, resolved);
    const { provider, authType, model } = resolved.route;
    return {
      ...(resolved.kind === 'virtual' ? { virtual: resolved.name } : { tier: resolved.name }),
      route: { provider, authType, model },
      public_model: resolved.publicModel,
      models: resolved.models,
      public_models: resolved.publicModels,
      params: specs.map(
        ({ provider: _p, authType: _a, model: _m, ...definition }): RouteModelParamView => ({
          ...definition,
          current: (getProviderParamValue(saved, definition.path) as JsonValue | undefined) ?? null,
        }),
      ),
    };
  }

  private unknownParam(path: string, model: string, specs: readonly ProviderParamSpec[]) {
    if (specs.length === 0) {
      return new BadRequestException(`${model} has no configurable params`);
    }
    return new BadRequestException(
      `Unknown param "${path}" for ${model}. Available: ${specs.map((s) => s.path).join(', ')}`,
    );
  }
}
