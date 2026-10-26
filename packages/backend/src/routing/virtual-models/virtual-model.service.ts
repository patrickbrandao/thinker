import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  DEFAULT_OUTPUT_MODALITY,
  DEFAULT_RESPONSE_MODE,
  DEFAULT_TIER_SLOT,
  MAX_VIRTUAL_MODEL_FALLBACKS,
  isOutputModality,
  isResponseMode,
  modelParamsScopeForVirtualModel,
  validateVirtualModelName,
  type ModelRoute,
  type OutputModality,
  type ResponseMode,
  type VirtualModelRouteInput,
  type VirtualModelView,
} from 'thinker-shared';
import { VirtualModel } from '../../entities/virtual-model.entity';
import { AgentModelParams } from '../../entities/agent-model-params.entity';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { RoutingCacheService } from '../routing-core/routing-cache.service';
import { ProviderKeyService } from '../routing-core/provider-key.service';
import { TierService } from '../routing-core/tier.service';
import {
  describeUnresolvedFallback,
  describeUnresolvedModel,
  resolveModelRoute,
} from '../routing-core/resolve-model-route';
import { assertStreamableResponseMode } from '../routing-core/response-mode-guard';
import {
  computeShadows,
  virtualModelContextLength,
  virtualModelRoutable,
  type DefaultTierChainSource,
  type RouteSnapshot,
} from './virtual-model-chain';

const PG_UNIQUE_VIOLATION = '23505';
const NAME_UNIQUE_INDEX = 'IDX_virtual_models_agent_name';

export interface CreateVirtualModelInput {
  name: string;
  override_route?: VirtualModelRouteInput | null;
  fallback_routes?: VirtualModelRouteInput[] | null;
  continue_on_default?: boolean;
  response_mode?: ResponseMode;
  output_modality?: OutputModality;
}

export interface UpdateVirtualModelInput {
  name?: string;
  continue_on_default?: boolean;
  output_modality?: OutputModality;
}

/**
 * Two writers can both pass the in-memory name check and race to the unique
 * (agent_id, LOWER(name)) index. TypeORM copies the pg error's `code` and
 * `constraint` onto the QueryFailedError, so the loser gets the same 409.
 */
function isNameUniqueViolation(err: unknown): boolean {
  const pg = err as { code?: unknown; constraint?: unknown } | null;
  return pg?.code === PG_UNIQUE_VIOLATION && pg.constraint === NAME_UNIQUE_INDEX;
}

function duplicateName(name: string): ConflictException {
  return new ConflictException(`A virtual model named "${name}" already exists on this agent`);
}

/** `sort_order`, then name: the order `/v1/models` will publish them in. */
function compareRows(a: VirtualModel, b: VirtualModel): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.name.localeCompare(b.name);
}

/**
 * Virtual models (ADR 0004): CRUD, validation and the cached per-agent list
 * the proxy reads. Every method takes the agent id already resolved inside
 * the caller's tenant (`ResolveAgentService`), and every row lookup filters
 * by that agent id, so an id from another agent or tenant is a 404.
 */
@Injectable()
export class VirtualModelService {
  constructor(
    @InjectRepository(VirtualModel)
    private readonly repo: Repository<VirtualModel>,
    private readonly routingCache: RoutingCacheService,
    private readonly discoveryService: ModelDiscoveryService,
    private readonly providerKeyService: ProviderKeyService,
    private readonly tierService: TierService,
  ) {}

  /** The agent's rows in publish order, served through the routing cache. */
  async list(agentId: string): Promise<VirtualModel[]> {
    const cached = this.routingCache.getVirtualModels(agentId);
    if (cached) return cached;
    const rows = (await this.repo.find({ where: { agent_id: agentId } })).sort(compareRows);
    this.routingCache.setVirtualModels(agentId, rows);
    return rows;
  }

  /** The admin listing: rows plus `shadows` and `context_length`, computed now. */
  async listViews(agentId: string, tenantId: string): Promise<VirtualModelView[]> {
    const rows = await this.list(agentId);
    if (rows.length === 0) return [];
    return this.toViews(agentId, tenantId, rows);
  }

  async create(
    agentId: string,
    tenantId: string,
    input: CreateVirtualModelInput,
  ): Promise<VirtualModelView> {
    const name = this.validateName(input.name);
    const responseMode = this.validateResponseMode(input.response_mode);
    const outputModality = this.validateOutputModality(input.output_modality);
    if (input.continue_on_default !== undefined && typeof input.continue_on_default !== 'boolean') {
      throw new BadRequestException('continue_on_default must be a boolean');
    }

    const existing = await this.repo.find({ where: { agent_id: agentId } });
    this.assertNameAvailable(existing, name);

    const catalog = await this.catalog(agentId, tenantId);
    const overrideRoute = input.override_route
      ? await this.resolveOverrideRoute(agentId, tenantId, input.override_route, catalog)
      : null;
    const fallbackInputs = input.fallback_routes ?? [];
    const fallbackRoutes =
      fallbackInputs.length > 0
        ? await this.buildFallbackRoutes(
            agentId,
            tenantId,
            fallbackInputs.map((r) => r.model),
            fallbackInputs,
            catalog,
          )
        : null;
    assertStreamableResponseMode(
      responseMode,
      `virtual model "${name}"`,
      overrideRoute,
      fallbackRoutes,
    );

    const nextOrder =
      existing.reduce((max, row) => (row.sort_order > max ? row.sort_order : max), -1) + 1;
    const now = new Date().toISOString();
    const record = Object.assign(new VirtualModel(), {
      id: randomUUID(),
      tenant_id: tenantId,
      agent_id: agentId,
      name,
      sort_order: nextOrder,
      enabled: true,
      override_route: overrideRoute,
      fallback_routes: fallbackRoutes,
      continue_on_default: input.continue_on_default ?? false,
      response_mode: responseMode,
      output_modality: outputModality,
      created_at: now,
      updated_at: now,
    });
    try {
      await this.repo.insert(record);
    } catch (err) {
      if (isNameUniqueViolation(err)) throw duplicateName(name);
      throw err;
    }
    this.routingCache.invalidateAgent(agentId);
    return this.toView(agentId, tenantId, record, catalog);
  }

  async update(
    agentId: string,
    tenantId: string,
    id: string,
    patch: UpdateVirtualModelInput,
  ): Promise<VirtualModelView> {
    const row = await this.findOrThrow(agentId, id);
    if (patch.name !== undefined) {
      const next = this.validateName(patch.name);
      const siblings = (await this.repo.find({ where: { agent_id: agentId } })).filter(
        (r) => r.id !== id,
      );
      this.assertNameAvailable(siblings, next);
      row.name = next;
    }
    if (patch.continue_on_default !== undefined) {
      if (typeof patch.continue_on_default !== 'boolean') {
        throw new BadRequestException('continue_on_default must be a boolean');
      }
      row.continue_on_default = patch.continue_on_default;
    }
    if (patch.output_modality !== undefined) {
      row.output_modality = this.validateOutputModality(patch.output_modality);
    }
    return this.persist(agentId, tenantId, row);
  }

  async setEnabled(
    agentId: string,
    tenantId: string,
    id: string,
    enabled: boolean,
  ): Promise<VirtualModelView> {
    if (typeof enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean');
    const row = await this.findOrThrow(agentId, id);
    row.enabled = enabled;
    return this.persist(agentId, tenantId, row);
  }

  async setResponseMode(
    agentId: string,
    tenantId: string,
    id: string,
    responseMode: ResponseMode,
  ): Promise<VirtualModelView> {
    const row = await this.findOrThrow(agentId, id);
    const mode = this.validateResponseMode(responseMode);
    assertStreamableResponseMode(
      mode,
      `virtual model "${row.name}"`,
      row.override_route,
      row.fallback_routes,
    );
    row.response_mode = mode;
    return this.persist(agentId, tenantId, row);
  }

  async setOverride(
    agentId: string,
    tenantId: string,
    id: string,
    input: VirtualModelRouteInput,
  ): Promise<VirtualModelView> {
    const row = await this.findOrThrow(agentId, id);
    const catalog = await this.catalog(agentId, tenantId);
    const route = await this.resolveOverrideRoute(agentId, tenantId, input, catalog);
    assertStreamableResponseMode(
      row.response_mode,
      `virtual model "${row.name}"`,
      route,
      row.fallback_routes,
    );
    row.override_route = route;
    return this.persist(agentId, tenantId, row, catalog);
  }

  /** Clears the primary and, as for header tiers, the fallbacks behind it. */
  async clearOverride(agentId: string, id: string): Promise<void> {
    const row = await this.findOrThrow(agentId, id);
    assertStreamableResponseMode(row.response_mode, `virtual model "${row.name}"`, null, null);
    row.override_route = null;
    row.fallback_routes = null;
    row.updated_at = new Date().toISOString();
    await this.repo.save(row);
    this.routingCache.invalidateAgent(agentId);
  }

  async setFallbacks(
    agentId: string,
    tenantId: string,
    id: string,
    models: string[],
    routes?: ModelRoute[],
  ): Promise<ModelRoute[]> {
    const row = await this.findOrThrow(agentId, id);
    const fallbackRoutes = await this.buildFallbackRoutes(
      agentId,
      tenantId,
      models,
      routes,
      await this.catalog(agentId, tenantId),
    );
    assertStreamableResponseMode(
      row.response_mode,
      `virtual model "${row.name}"`,
      row.override_route,
      fallbackRoutes,
    );
    row.fallback_routes = fallbackRoutes;
    row.updated_at = new Date().toISOString();
    await this.repo.save(row);
    this.routingCache.invalidateAgent(agentId);
    return row.fallback_routes ?? [];
  }

  async clearFallbacks(agentId: string, id: string): Promise<void> {
    const row = await this.findOrThrow(agentId, id);
    assertStreamableResponseMode(
      row.response_mode,
      `virtual model "${row.name}"`,
      row.override_route,
      null,
    );
    row.fallback_routes = null;
    row.updated_at = new Date().toISOString();
    await this.repo.save(row);
    this.routingCache.invalidateAgent(agentId);
  }

  async reorder(agentId: string, ids: string[]): Promise<void> {
    if (!Array.isArray(ids)) {
      throw new BadRequestException('reorder: ids must be an array');
    }
    const rows = await this.repo.find({ where: { agent_id: agentId } });
    // Bound the loop by the stored row count, not the caller's array length
    // (CodeQL: js/loop-bound-injection), as in HeaderTierService.reorder.
    if (ids.length !== rows.length) {
      throw new BadRequestException(
        'reorder list must include every existing virtual model exactly once',
      );
    }
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('reorder list must not contain duplicate ids');
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (!ids.every((id) => byId.has(id))) {
      throw new BadRequestException(
        'reorder list must include every existing virtual model exactly once',
      );
    }
    const now = new Date().toISOString();
    for (let i = 0; i < rows.length; i++) {
      const row = byId.get(ids[i])!;
      row.sort_order = i;
      row.updated_at = now;
    }
    await this.repo.save([...byId.values()]);
    this.routingCache.invalidateAgent(agentId);
  }

  /**
   * Deletes the row and the per-model params configured under its
   * `virtual:<id>` scope, in one transaction so no orphan params survive.
   */
  async delete(agentId: string, id: string): Promise<void> {
    const row = await this.findOrThrow(agentId, id);
    await this.repo.manager.transaction(async (manager) => {
      await manager.delete(AgentModelParams, {
        agent_id: agentId,
        scope_key: modelParamsScopeForVirtualModel(row.id),
      });
      await manager.delete(VirtualModel, { id: row.id, agent_id: agentId });
    });
    // Drops the virtual-model list and the model-params cache together.
    this.routingCache.invalidateAgent(agentId);
  }

  private async persist(
    agentId: string,
    tenantId: string,
    row: VirtualModel,
    catalog?: readonly DiscoveredModel[],
  ): Promise<VirtualModelView> {
    row.updated_at = new Date().toISOString();
    try {
      await this.repo.save(row);
    } catch (err) {
      if (isNameUniqueViolation(err)) throw duplicateName(row.name);
      throw err;
    }
    this.routingCache.invalidateAgent(agentId);
    return this.toView(agentId, tenantId, row, catalog);
  }

  private async toView(
    agentId: string,
    tenantId: string,
    row: VirtualModel,
    catalog?: readonly DiscoveredModel[],
  ): Promise<VirtualModelView> {
    const [view] = await this.toViews(agentId, tenantId, [row], catalog);
    return view;
  }

  /**
   * `shadows`, `context_length` and `routable` for every row from one catalog
   * snapshot plus the agent's credential rows, both loaded once (ADR 0004,
   * section 7): a request never reloads discovery or queries providers per
   * route. A route of a provider the agent no longer has (disconnected or
   * disabled) is unavailable, as in the proxy.
   */
  private async toViews(
    agentId: string,
    tenantId: string,
    rows: readonly VirtualModel[],
    snapshot?: readonly DiscoveredModel[],
  ): Promise<VirtualModelView[]> {
    const [catalog, providers, defaultTier] = await Promise.all([
      snapshot ?? this.catalog(agentId, tenantId),
      this.providerKeyService.getRouteProviderRecords(tenantId, agentId),
      rows.some((r) => r.continue_on_default) ? this.defaultTier(agentId) : null,
    ]);
    const routeSnapshot: RouteSnapshot = { catalog, providers };
    const contextLengths = await Promise.all(
      rows.map((row) => virtualModelContextLength(row, defaultTier, routeSnapshot)),
    );
    const routable = await Promise.all(
      rows.map((row) => virtualModelRoutable(row, defaultTier, routeSnapshot)),
    );
    return rows.map((row, i) => ({
      id: row.id,
      agent_id: row.agent_id,
      name: row.name,
      sort_order: row.sort_order,
      enabled: row.enabled,
      override_route: row.override_route,
      fallback_routes: row.fallback_routes,
      continue_on_default: row.continue_on_default,
      response_mode: row.response_mode,
      output_modality: row.output_modality,
      created_at: row.created_at,
      updated_at: row.updated_at,
      shadows: computeShadows(row.name, catalog),
      context_length: contextLengths[i],
      routable: routable[i],
    }));
  }

  /** One discovery snapshot of the agent's catalog. */
  private catalog(agentId: string, tenantId: string): Promise<DiscoveredModel[]> {
    return this.discoveryService.getModelsForAgent(tenantId, agentId);
  }

  private async defaultTier(agentId: string): Promise<DefaultTierChainSource | null> {
    const tiers = await this.tierService.getTiers(agentId);
    return tiers.find((t) => t.tier === DEFAULT_TIER_SLOT) ?? null;
  }

  /**
   * Strict write-time validation (ADR 0004 review): the route must resolve to
   * exactly one model the agent's enabled providers offer, or the write is a
   * 400. Unlike a header tier, an explicit (provider, authType) the catalog
   * does not list is not kept as given. A sent key label is then validated
   * (see validateKeyLabel).
   */
  private async resolveOverrideRoute(
    agentId: string,
    tenantId: string,
    input: VirtualModelRouteInput,
    available: readonly DiscoveredModel[],
  ): Promise<ModelRoute> {
    const model = typeof input?.model === 'string' ? input.model.trim() : '';
    if (!model) throw new BadRequestException('A primary model is required');
    const scope = { provider: input.provider, authType: input.authType };
    const resolution = resolveModelRoute(model, available, scope);
    if (!resolution.ok) {
      throw new BadRequestException(
        describeUnresolvedModel(model, resolution.reason, available, scope),
      );
    }
    return this.validateKeyLabel(agentId, tenantId, resolution.route, input.keyLabel);
  }

  /**
   * Strict fallback resolution with the 5-route cap. When `routes` lines up
   * with `models`, each entry resolves within whatever (provider, authType)
   * it carries and keeps its key label; otherwise each name resolves alone.
   * Create passes its route inputs here, which may carry a key label with no
   * provider. Every entry
   * is checked against the current catalog, previously stored ones included:
   * a fallback on a provider the agent no longer has is a 400, so the
   * operator removes it instead of carrying an unreachable route.
   */
  private async buildFallbackRoutes(
    agentId: string,
    tenantId: string,
    models: string[],
    routes: readonly VirtualModelRouteInput[] | undefined,
    available: readonly DiscoveredModel[],
  ): Promise<ModelRoute[] | null> {
    if (!Array.isArray(models)) throw new BadRequestException('models must be an array');
    if (models.length > MAX_VIRTUAL_MODEL_FALLBACKS) {
      throw new BadRequestException(
        `A virtual model can have at most ${MAX_VIRTUAL_MODEL_FALLBACKS} fallbacks`,
      );
    }
    if (models.length === 0) return null;
    const aligned =
      Array.isArray(routes) &&
      routes.length === models.length &&
      routes.every((r, i) => r?.model === models[i]);
    const resolved: ModelRoute[] = [];
    for (let i = 0; i < models.length; i++) {
      const model = typeof models[i] === 'string' ? models[i].trim() : '';
      const given = aligned ? routes![i] : undefined;
      const resolution = model
        ? resolveModelRoute(model, available, {
            provider: given?.provider,
            authType: given?.authType,
          })
        : null;
      if (!resolution?.ok) throw new BadRequestException(describeUnresolvedFallback(models[i]));
      resolved.push(
        await this.validateKeyLabel(agentId, tenantId, resolution.route, given?.keyLabel),
      );
    }
    return resolved;
  }

  /**
   * Write-time key label check. A label the caller sent must name one of the
   * agent's keys for the route's (provider, authType), or the write is a 400;
   * it is stored with the key's own spelling. Without one the route is stored
   * with no label: the default key is picked per request (PR 2, as for
   * tiers), so changing a provider's default key later still applies.
   */
  private async validateKeyLabel(
    agentId: string,
    tenantId: string,
    route: ModelRoute,
    requested: string | null | undefined,
  ): Promise<ModelRoute> {
    const base: ModelRoute = {
      provider: route.provider,
      authType: route.authType,
      model: route.model,
    };
    const wanted = typeof requested === 'string' ? requested.trim() : '';
    if (!wanted) return base;
    const keys = await this.providerKeyService.getProviderKeys(
      tenantId,
      base.provider,
      base.authType,
      agentId,
    );
    // Exact label first. A case-insensitive match is accepted only when it is
    // the single one, so "Work" and "work" on one connection never resolve
    // to an arbitrary key.
    const exact = keys.find((k) => k.label === wanted);
    const folded = keys.filter((k) => k.label.toLowerCase() === wanted.toLowerCase());
    const match = exact ?? (folded.length === 1 ? folded[0] : undefined);
    if (!match && folded.length > 1) {
      throw new BadRequestException(
        `Provider key "${wanted}" matches several keys for ${base.provider} (${base.authType}); use the exact label`,
      );
    }
    if (!match) {
      throw new BadRequestException(
        `Provider key "${wanted}" is not connected for ${base.provider} (${base.authType}) on this agent`,
      );
    }
    return { ...base, keyLabel: match.label };
  }

  private async findOrThrow(agentId: string, id: string): Promise<VirtualModel> {
    const row = await this.repo.findOne({ where: { id, agent_id: agentId } });
    if (!row) throw new NotFoundException('Virtual model not found');
    return row;
  }

  private validateName(raw: unknown): string {
    const result = validateVirtualModelName(raw);
    if (!result.ok) throw new BadRequestException(result.error);
    return result.name;
  }

  private validateResponseMode(raw: unknown): ResponseMode {
    if (raw === undefined || raw === null) return DEFAULT_RESPONSE_MODE;
    if (!isResponseMode(raw)) throw new BadRequestException('Invalid response_mode');
    return raw;
  }

  private validateOutputModality(raw: unknown): OutputModality {
    if (raw === undefined || raw === null) return DEFAULT_OUTPUT_MODALITY;
    if (!isOutputModality(raw)) throw new BadRequestException('Invalid output_modality');
    return raw;
  }

  /** Disabled rows hold their name too (ADR 0004, section 3). */
  private assertNameAvailable(existing: readonly VirtualModel[], name: string): void {
    const lower = name.toLowerCase();
    if (existing.some((row) => row.name.toLowerCase() === lower)) throw duplicateName(name);
  }
}
