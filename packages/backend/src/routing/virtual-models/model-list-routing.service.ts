import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_TIER_SLOT } from 'thinker-shared';
import { Agent } from '../../entities/agent.entity';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { TierService } from '../routing-core/tier.service';
import { SpecificityService } from '../routing-core/specificity.service';
import { ProviderKeyService } from '../routing-core/provider-key.service';
import { VirtualModelService } from './virtual-model.service';
import { virtualModelContextLength, type RouteSnapshot } from './virtual-model-chain';
import { autoContextLength } from './model-list-context';

/** A virtual model as `/v1/models` publishes it. */
export interface ModelListVirtualEntry {
  name: string;
  /** Null when the window is unknown or the chain is empty (field omitted). */
  context_length: number | null;
}

export interface ModelListRouting {
  /** `context_length` of `auto`; null means omitted. */
  autoContextLength: number | null;
  /** The agent's enabled virtual models, in publish order. */
  virtuals: ModelListVirtualEntry[];
}

/**
 * The routing facts `GET /v1/models` publishes besides the real models
 * (ADR 0004, section 7): the agent's enabled virtual models and the
 * `context_length` of `auto` and of each virtual model. Everything is judged
 * from the catalog snapshot the listing already loaded plus the agent's
 * credential rows, loaded once here, so a request never reloads discovery or
 * checks availability route by route. A route of a provider the agent no
 * longer has (disconnected or disabled) is unavailable, as in the proxy, so
 * it never counts toward a window. Tier, specificity and virtual-model rows
 * come from the routing cache.
 *
 * Scoped by the agent id the agent-key guard resolved; the agent row lookup
 * filters by tenant too.
 */
@Injectable()
export class ModelListRoutingService {
  constructor(
    private readonly virtualModels: VirtualModelService,
    private readonly tierService: TierService,
    private readonly specificityService: SpecificityService,
    private readonly providerKeyService: ProviderKeyService,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
  ) {}

  async forAgent(
    agentId: string,
    tenantId: string,
    catalog: readonly DiscoveredModel[],
  ): Promise<ModelListRouting> {
    const [rows, tiers, agent, providers] = await Promise.all([
      this.virtualModels.list(agentId),
      this.tierService.getTiers(agentId),
      this.agentRepo.findOne({
        where: { id: agentId, tenant_id: tenantId },
        select: { id: true, complexity_routing_enabled: true },
      }),
      this.providerKeyService.getRouteProviderRecords(tenantId, agentId),
    ]);
    const snapshot: RouteSnapshot = { catalog, providers };
    // Same reading as ResolveService.resolveLazy: only an agent that has the
    // flag off skips complexity routing.
    const complexityRoutingEnabled = !agent || agent.complexity_routing_enabled;
    const specificity = complexityRoutingEnabled
      ? await this.specificityService.getActiveAssignments(agentId)
      : [];

    const enabled = rows.filter((row) => row.enabled);
    const defaultTier = tiers.find((t) => t.tier === DEFAULT_TIER_SLOT) ?? null;
    const contextLengths = await Promise.all(
      enabled.map((row) => virtualModelContextLength(row, defaultTier, snapshot)),
    );

    return {
      autoContextLength: autoContextLength({
        complexityRoutingEnabled,
        tiers,
        specificity,
        snapshot,
      }),
      virtuals: enabled.map((row, i) => ({ name: row.name, context_length: contextLengths[i] })),
    };
  }
}
