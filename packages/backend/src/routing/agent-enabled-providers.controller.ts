import {
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { AgentEnabledProvider } from '../entities/agent-enabled-provider.entity';
import { Agent } from '../entities/agent.entity';
import { TenantProvider } from '../entities/tenant-provider.entity';
import { TierAssignment } from '../entities/tier-assignment.entity';
import { SpecificityAssignment } from '../entities/specificity-assignment.entity';
import { HeaderTier } from '../entities/header-tier.entity';
import { ProviderService } from './routing-core/provider.service';
import { VirtualModelService } from './virtual-models/virtual-model.service';
import {
  agentDisableBlockedMessage,
  collectAffectedVirtualModels,
  makeAgentProviderRouteMatcher,
  type AffectedVirtualModel,
} from './routing-core/agent-provider-impact';
import { MinRole } from '../common/decorators/roles.decorator';

@MinRole('admin')
@Controller('api/v1/agents/:agentName/enabled-providers')
export class AgentEnabledProvidersController {
  constructor(
    @InjectRepository(AgentEnabledProvider)
    private readonly enabledProviderRepo: Repository<AgentEnabledProvider>,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    @InjectRepository(TenantProvider)
    private readonly tenantProviderRepo: Repository<TenantProvider>,
    @InjectRepository(TierAssignment)
    private readonly tierRepo: Repository<TierAssignment>,
    @InjectRepository(SpecificityAssignment)
    private readonly specificityRepo: Repository<SpecificityAssignment>,
    @InjectRepository(HeaderTier)
    private readonly headerTierRepo: Repository<HeaderTier>,
    private readonly providerService: ProviderService,
    private readonly virtualModels: VirtualModelService,
  ) {}

  private async resolveAgent(agentName: string, tenantId: string | null) {
    if (!tenantId) return null;
    // Exclude the reserved Playground agent — its enabled providers are the global
    // pool and must not be togglable/removable through this per-agent endpoint.
    // Exclude soft-deleted agents too: a new agent can reuse a deleted one's name,
    // and without this filter both rows match and findOne may return the dead one.
    return this.agentRepo.findOne({
      where: {
        name: decodeURIComponent(agentName),
        tenant_id: tenantId,
        is_playground: false,
        deleted_at: IsNull(),
      },
    });
  }

  @Get()
  async listEnabled(@TenantCtx() ctx: TenantContext, @Param('agentName') agentName: string) {
    const agent = await this.resolveAgent(agentName, ctx.tenantId);
    if (!agent) return { enabled: [] };

    const rows = await this.enabledProviderRepo.find({ where: { agent_id: agent.id } });
    return { enabled: rows.map((r) => r.tenant_provider_id) };
  }

  @Get(':tenantProviderId/impact')
  async getDisableImpact(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('tenantProviderId') tenantProviderId: string,
  ) {
    const agent = await this.resolveAgent(agentName, ctx.tenantId);
    if (!agent) throw new HttpException('Agent not found', HttpStatus.NOT_FOUND);

    const provider = await this.tenantProviderRepo.findOne({
      where: { id: tenantProviderId, tenant_id: agent.tenant_id },
    });
    // Match enable/disable: a provider id that isn't the caller's is a 404, not
    // an empty result. Returning [] here would be an existence oracle and an
    // inconsistent ownership contract across the three handlers.
    if (!provider) throw new HttpException('Provider not found', HttpStatus.NOT_FOUND);

    return {
      affected_tiers: await this.findAffectedRoutes(agent.id, provider),
      affected_virtual_models: await this.findAffectedVirtualModels(agent, provider),
    };
  }

  /**
   * Virtual models of this harness (enabled or not) whose own override or
   * fallbacks run on the provider. Routes inherited from Default are covered by
   * the tier scan above.
   */
  private async findAffectedVirtualModels(
    agent: Agent,
    provider: TenantProvider,
  ): Promise<AffectedVirtualModel[]> {
    // The resolved agent is already tenant-scoped; list() serves the rows in
    // publish order through the routing cache.
    const rows = await this.virtualModels.list(agent.id);
    return collectAffectedVirtualModels(rows, agent.name, makeAgentProviderRouteMatcher(provider));
  }

  private async findAffectedRoutes(agentId: string, provider: TenantProvider) {
    const routeBelongsToDisabledProvider = makeAgentProviderRouteMatcher(provider);

    const tiers = await this.tierRepo.find({ where: { agent_id: agentId } });
    const affected: Array<{ tier: string; model: string; position: string }> = [];

    for (const tier of tiers) {
      if (routeBelongsToDisabledProvider(tier.override_route)) {
        affected.push({ tier: tier.tier, model: tier.override_route!.model, position: 'primary' });
      }
      for (const [i, fb] of (tier.fallback_routes ?? []).entries()) {
        if (routeBelongsToDisabledProvider(fb)) {
          affected.push({ tier: tier.tier, model: fb.model, position: `fallback ${i + 1}` });
        }
      }
    }

    const specificityRows = await this.specificityRepo.find({ where: { agent_id: agentId } });
    for (const assignment of specificityRows) {
      if (routeBelongsToDisabledProvider(assignment.override_route)) {
        affected.push({
          tier: assignment.category,
          model: assignment.override_route!.model,
          position: 'primary',
        });
      }
      for (const [i, fb] of (assignment.fallback_routes ?? []).entries()) {
        if (routeBelongsToDisabledProvider(fb)) {
          affected.push({
            tier: assignment.category,
            model: fb.model,
            position: `fallback ${i + 1}`,
          });
        }
      }
    }

    const headerTiers = await this.headerTierRepo.find({ where: { agent_id: agentId } });
    for (const tier of headerTiers) {
      if (routeBelongsToDisabledProvider(tier.override_route)) {
        affected.push({ tier: tier.name, model: tier.override_route!.model, position: 'primary' });
      }
      for (const [i, fb] of (tier.fallback_routes ?? []).entries()) {
        if (routeBelongsToDisabledProvider(fb)) {
          affected.push({ tier: tier.name, model: fb.model, position: `fallback ${i + 1}` });
        }
      }
    }

    return affected;
  }

  @Put(':tenantProviderId')
  async enable(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('tenantProviderId') tenantProviderId: string,
  ) {
    const agent = await this.resolveAgent(agentName, ctx.tenantId);
    if (!agent) throw new HttpException('Agent not found', HttpStatus.NOT_FOUND);

    const provider = await this.tenantProviderRepo.findOne({
      where: { id: tenantProviderId, tenant_id: agent.tenant_id },
    });
    if (!provider) throw new HttpException('Provider not found', HttpStatus.NOT_FOUND);

    await this.enabledProviderRepo
      .createQueryBuilder()
      .insert()
      .into(AgentEnabledProvider)
      .values({ agent_id: agent.id, tenant_provider_id: tenantProviderId })
      .orIgnore()
      .execute();
    await this.providerService.recalculateTiers(agent.id, agent.tenant_id);

    return { ok: true };
  }

  @Delete(':tenantProviderId')
  async disable(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('tenantProviderId') tenantProviderId: string,
  ) {
    const agent = await this.resolveAgent(agentName, ctx.tenantId);
    if (!agent) throw new HttpException('Agent not found', HttpStatus.NOT_FOUND);

    const provider = await this.tenantProviderRepo.findOne({
      where: { id: tenantProviderId, tenant_id: agent.tenant_id },
    });
    if (provider) {
      const affected = await this.findAffectedRoutes(agent.id, provider);
      const affectedVirtuals = await this.findAffectedVirtualModels(agent, provider);
      if (affected.length > 0 || affectedVirtuals.length > 0) {
        throw new ConflictException(agentDisableBlockedMessage(affected.length, affectedVirtuals));
      }
    }

    await this.enabledProviderRepo.delete({
      agent_id: agent.id,
      tenant_provider_id: tenantProviderId,
    });
    await this.providerService.recalculateTiers(agent.id, agent.tenant_id);
    return { ok: true };
  }
}
