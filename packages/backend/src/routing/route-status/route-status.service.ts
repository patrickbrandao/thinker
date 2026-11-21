import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ROUTE_CHAIN_KINDS,
  withDisabled,
  type ChainRouteStatus,
  type ModelRoute,
  type SetRouteDisabledRequest,
} from 'thinker-shared';
import { VirtualModel } from '../../entities/virtual-model.entity';
import { TierAssignment } from '../../entities/tier-assignment.entity';
import { SpecificityAssignment } from '../../entities/specificity-assignment.entity';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import { ProviderKeyService } from '../routing-core/provider-key.service';
import { RoutingCacheService } from '../routing-core/routing-cache.service';
import { readFallbackRoutes, readOverrideRoute } from '../routing-core/route-helpers';
import { chainRouteStatus, type RouteSnapshot } from '../virtual-models/virtual-model-chain';

type ChainRow = Pick<VirtualModel, 'override_route' | 'fallback_routes'> & { updated_at: unknown };

/**
 * Route status (active, active_oos, disabled, disabled_oos) of the routes of
 * an agent's chains: virtual models, tiers and specificity categories. Only
 * the administrator's choice is stored (`disabled` on the route); whether the
 * provider still offers the model is read from the catalog on every call, so
 * a route goes back to service as soon as its model is listed again.
 */
@Injectable()
export class RouteStatusService {
  constructor(
    @InjectRepository(VirtualModel)
    private readonly virtualRepo: Repository<VirtualModel>,
    @InjectRepository(TierAssignment)
    private readonly tierRepo: Repository<TierAssignment>,
    @InjectRepository(SpecificityAssignment)
    private readonly specificityRepo: Repository<SpecificityAssignment>,
    private readonly discoveryService: ModelDiscoveryService,
    private readonly providerKeyService: ProviderKeyService,
    private readonly routingCache: RoutingCacheService,
  ) {}

  /** One catalog and credential snapshot of the agent. */
  async snapshot(tenantId: string, agentId: string): Promise<RouteSnapshot> {
    const [catalog, providers] = await Promise.all([
      this.discoveryService.getModelsForAgent(tenantId, agentId),
      this.providerKeyService.getRouteProviderRecords(tenantId, agentId),
    ]);
    return { catalog, providers };
  }

  /** Rows with `route_status` added, judged from one snapshot. */
  async withStatus<T extends Pick<VirtualModel, 'override_route' | 'fallback_routes'>>(
    tenantId: string,
    agentId: string,
    rows: readonly T[],
  ): Promise<Array<T & { route_status: ChainRouteStatus }>> {
    if (rows.length === 0) return [];
    const snapshot = await this.snapshot(tenantId, agentId);
    return rows.map((row) => ({ ...row, route_status: chainRouteStatus(row, snapshot) }));
  }

  /** One chain row with its route status (for endpoints that return the updated row). */
  async withStatusOne<T extends Pick<VirtualModel, 'override_route' | 'fallback_routes'>>(
    tenantId: string,
    agentId: string,
    row: T,
  ): Promise<T & { route_status: ChainRouteStatus }> {
    const [withStatus] = await this.withStatus(tenantId, agentId, [row]);
    return withStatus;
  }

  /** Disables or re-enables one stored route of a chain. */
  async setDisabled(agentId: string, input: SetRouteDisabledRequest): Promise<void> {
    if (!input || !ROUTE_CHAIN_KINDS.includes(input.chain)) {
      throw new BadRequestException(`chain must be one of ${ROUTE_CHAIN_KINDS.join(', ')}`);
    }
    if (typeof input.key !== 'string' || input.key.trim() === '') {
      throw new BadRequestException('key is required');
    }
    if (typeof input.disabled !== 'boolean') {
      throw new BadRequestException('disabled must be a boolean');
    }
    const position = input.position;
    if (position !== 'primary' && !(Number.isInteger(position) && (position as number) >= 0)) {
      throw new BadRequestException('position must be "primary" or a fallback index');
    }

    const { row, save } = await this.loadRow(agentId, input.chain, input.key);
    if (position === 'primary') {
      const route = readOverrideRoute(row);
      if (!route) throw new NotFoundException('This chain has no primary route');
      row.override_route = withDisabled(route, input.disabled);
    } else {
      const fallbacks = readFallbackRoutes(row) ?? [];
      const route: ModelRoute | undefined = fallbacks[position];
      if (!route) throw new NotFoundException(`Fallback ${position} not found`);
      row.fallback_routes = fallbacks.map((r, i) =>
        i === position ? withDisabled(r, input.disabled) : r,
      );
    }
    row.updated_at = new Date().toISOString();
    await save();
    this.routingCache.invalidateAgent(agentId);
  }

  private async loadRow(
    agentId: string,
    chain: SetRouteDisabledRequest['chain'],
    key: string,
  ): Promise<{ row: ChainRow; save: () => Promise<unknown> }> {
    if (chain === 'virtual_model') {
      const row = await this.virtualRepo.findOne({ where: { id: key, agent_id: agentId } });
      if (!row) throw new NotFoundException('Virtual model not found');
      return { row, save: () => this.virtualRepo.save(row) };
    }
    if (chain === 'tier') {
      const row = await this.tierRepo.findOne({ where: { agent_id: agentId, tier: key } });
      if (!row) throw new NotFoundException('Tier not found');
      return { row, save: () => this.tierRepo.save(row) };
    }
    const row = await this.specificityRepo.findOne({
      where: { agent_id: agentId, category: key },
    });
    if (!row) throw new NotFoundException('Specificity category not found');
    return { row, save: () => this.specificityRepo.save(row) };
  }
}
