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
  /** Every model the tier or virtual model routes to, primary first — the valid `model` inputs. */
  models: string[];
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
}

interface RouteFamily {
  kind: 'tier' | 'virtual';
  name: string;
  scope: string;
  primary: ModelRoute | null;
  fallbacks: ModelRoute[];
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
  ) {}

  /** `target` is a tier name (the default tier when omitted) or `{ virtual }`. */
  async get(
    agentId: string,
    target: string | RouteParamsTarget = DEFAULT_TIER_NAME,
    model?: string,
  ): Promise<RouteModelParamsView> {
    const resolved = await this.resolve(agentId, target, model);
    const specs = await this.specsFor(resolved);
    return this.view(agentId, resolved, specs);
  }

  async update(
    agentId: string,
    target: string | RouteParamsTarget | undefined,
    model: string | undefined,
    change: RouteModelParamsChange,
  ): Promise<RouteModelParamsView> {
    const setEntries = Object.entries(change.set ?? {});
    const unset = change.unset ?? [];
    if (setEntries.length === 0 && unset.length === 0) {
      throw new BadRequestException('Nothing to change: pass at least one param to set or unset');
    }

    for (const path of [...unset, ...setEntries.map(([p]) => p)]) {
      if (!isProviderParamPath(path)) throw new BadRequestException(`Invalid param path "${path}"`);
    }

    const resolved = await this.resolve(agentId, target ?? DEFAULT_TIER_NAME, model);
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

    if (model === undefined) {
      if (!primary) {
        throw new BadRequestException(
          `${label.charAt(0).toUpperCase()}${label.slice(1)} has no model yet` +
            (kind === 'virtual'
              ? '; routes it borrows from the Default tier take the default tier params'
              : ''),
        );
      }
      return this.resolved(family, primary, models);
    }

    const wanted = (r: ModelRoute) => normalizeProviderModel(r.provider, model);
    const matches = routes.filter(
      (r) => r.model === model || normalizeProviderModel(r.provider, r.model) === wanted(r),
    );
    if (matches.length === 0) {
      throw new BadRequestException(
        `Model "${model}" is not routed by ${label}. Models: ${models.join(', ')}`,
      );
    }
    const connections = new Set(matches.map((r) => `${r.provider.toLowerCase()}|${r.authType}`));
    if (connections.size > 1) {
      throw new BadRequestException(
        `Model "${model}" is routed through more than one connection in ${label}; set its params from the dashboard`,
      );
    }
    return this.resolved(family, matches[0], models);
  }

  private resolved(family: RouteFamily, route: ModelRoute, models: string[]): ResolvedRoute {
    const paramsModel = normalizeProviderModel(route.provider, route.model);
    return {
      kind: family.kind,
      name: family.name,
      scope: family.scope,
      route,
      paramsModel,
      models,
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
      models: resolved.models,
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
