import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../../common/decorators/tenant-context.decorator';
import { ResolveAgentService } from '../routing-core/resolve-agent.service';
import {
  TierModelParamsPathDto,
  TierModelParamsQueryDto,
  UpdateTierModelParamsBodyDto,
  VirtualModelParamsQueryDto,
} from '../dto/model-params.dto';
import { AgentNameParamDto } from '../dto/routing.dto';
import { RouteModelParamsService, type RouteModelParamsView } from './route-model-params.service';

/**
 * Model params addressed by tier + model, for the CLI (`thinker routing params`).
 * `:tier` is `default` or a custom tier's name; `?model=` picks one of the
 * models the tier routes to and defaults to its primary. The query string
 * carries the model because model ids contain slashes.
 *
 * `virtual-model-params?virtual=<name>` is the same for a virtual model
 * (ADR 0004, section 9): a separate selector, since a virtual model and a
 * custom tier may share a name. It reads and writes the `virtual:<id>` scope.
 */
@Controller('api/v1/routing')
export class RouteModelParamsController {
  constructor(
    private readonly routeParams: RouteModelParamsService,
    private readonly resolveAgentService: ResolveAgentService,
  ) {}

  @Get(':agentName/tiers/:tier/model-params')
  async get(
    @TenantCtx() ctx: TenantContext,
    @Param() params: TierModelParamsPathDto,
    @Query() query: TierModelParamsQueryDto,
  ): Promise<RouteModelParamsView> {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    return this.routeParams.get(agent.id, params.tier, query.model, agent.tenant_id);
  }

  @Patch(':agentName/tiers/:tier/model-params')
  async update(
    @TenantCtx() ctx: TenantContext,
    @Param() params: TierModelParamsPathDto,
    @Query() query: TierModelParamsQueryDto,
    @Body() body: UpdateTierModelParamsBodyDto,
  ): Promise<RouteModelParamsView> {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    return this.routeParams.update(
      agent.id,
      params.tier,
      query.model,
      {
        set: body.set,
        unset: body.unset,
      },
      agent.tenant_id,
    );
  }

  @Get(':agentName/virtual-model-params')
  async getVirtual(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentNameParamDto,
    @Query() query: VirtualModelParamsQueryDto,
  ): Promise<RouteModelParamsView> {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    return this.routeParams.get(agent.id, { virtual: query.virtual }, query.model, agent.tenant_id);
  }

  @Patch(':agentName/virtual-model-params')
  async updateVirtual(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentNameParamDto,
    @Query() query: VirtualModelParamsQueryDto,
    @Body() body: UpdateTierModelParamsBodyDto,
  ): Promise<RouteModelParamsView> {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    return this.routeParams.update(
      agent.id,
      { virtual: query.virtual },
      query.model,
      {
        set: body.set,
        unset: body.unset,
      },
      agent.tenant_id,
    );
  }
}
