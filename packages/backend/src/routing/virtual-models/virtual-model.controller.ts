import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { TenantCtx, TenantContext } from '../../common/decorators/tenant-context.decorator';
import { ResolveAgentService } from '../routing-core/resolve-agent.service';
import { SetResponseModeDto, responseModeFromDto } from '../dto/routing.dto';
import { FallbacksBody, OverrideBody } from '../header-tiers/header-tier.controller';
import { VirtualModelService } from './virtual-model.service';
import {
  CreateVirtualModelDto,
  ReorderVirtualModelsDto,
  ToggleVirtualModelDto,
  UpdateVirtualModelDto,
} from './virtual-model.dto';
import { MinRole } from '../../common/decorators/roles.decorator';

/**
 * Admin API for virtual models (ADR 0004), in parity with
 * `header-tiers`. The agent is resolved inside the caller's tenant first, and
 * the service scopes every row to that agent, so another agent's or tenant's
 * id is a 404.
 */
@MinRole('admin')
@Controller('api/v1/routing')
export class VirtualModelController {
  constructor(
    private readonly virtualModelService: VirtualModelService,
    private readonly resolveAgentService: ResolveAgentService,
  ) {}

  @Get(':agentName/virtual-models')
  async list(@TenantCtx() ctx: TenantContext, @Param('agentName') agentName: string) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    return this.virtualModelService.listViews(agent.id, agent.tenant_id);
  }

  @Post(':agentName/virtual-models')
  async create(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Body() body: CreateVirtualModelDto,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    return this.virtualModelService.create(agent.id, agent.tenant_id, body);
  }

  @Post(':agentName/virtual-models/reorder')
  async reorder(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Body() body: ReorderVirtualModelsDto,
  ) {
    if (!body || !Array.isArray(body.ids)) {
      throw new BadRequestException('reorder: body.ids must be an array');
    }
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    await this.virtualModelService.reorder(agent.id, body.ids);
    return { ok: true };
  }

  @Put(':agentName/virtual-models/:id')
  async update(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
    @Body() body: UpdateVirtualModelDto,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    return this.virtualModelService.update(agent.id, agent.tenant_id, id, body);
  }

  @Patch(':agentName/virtual-models/:id/toggle')
  async toggle(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
    @Body() body: ToggleVirtualModelDto,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    return this.virtualModelService.setEnabled(agent.id, agent.tenant_id, id, body.enabled);
  }

  @Patch(':agentName/virtual-models/:id/response-mode')
  async setResponseMode(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
    @Body() body: SetResponseModeDto,
  ) {
    const responseMode = responseModeFromDto(body);
    if (!responseMode) throw new BadRequestException('response_mode is required');
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    return this.virtualModelService.setResponseMode(agent.id, agent.tenant_id, id, responseMode);
  }

  @Delete(':agentName/virtual-models/:id')
  async delete(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    await this.virtualModelService.delete(agent.id, id);
    return { ok: true };
  }

  @Put(':agentName/virtual-models/:id/override')
  async setOverride(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
    @Body() body: OverrideBody,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    return this.virtualModelService.setOverride(agent.id, agent.tenant_id, id, {
      model: body.route?.model ?? body.model,
      provider: body.route?.provider ?? body.provider,
      authType: body.route?.authType ?? body.authType,
      keyLabel: body.route?.keyLabel ?? body.providerKeyLabel,
    });
  }

  @Delete(':agentName/virtual-models/:id/override')
  async clearOverride(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    await this.virtualModelService.clearOverride(agent.id, id);
    return { ok: true };
  }

  @Put(':agentName/virtual-models/:id/fallbacks')
  async setFallbacks(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
    @Body() body: FallbacksBody,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    return this.virtualModelService.setFallbacks(
      agent.id,
      agent.tenant_id,
      id,
      body.models,
      body.routes,
    );
  }

  @Delete(':agentName/virtual-models/:id/fallbacks')
  async clearFallbacks(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    await this.virtualModelService.clearFallbacks(agent.id, id);
    return { ok: true };
  }
}
