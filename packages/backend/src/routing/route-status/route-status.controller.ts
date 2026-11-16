import { Body, Controller, Param, Patch } from '@nestjs/common';
import type { SetRouteDisabledRequest } from 'thinker-shared';
import { TenantCtx, TenantContext } from '../../common/decorators/tenant-context.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { ResolveAgentService } from '../routing-core/resolve-agent.service';
import { RouteStatusService } from './route-status.service';

@MinRole('admin')
@Controller('api/v1/routing')
export class RouteStatusController {
  constructor(
    private readonly routeStatus: RouteStatusService,
    private readonly resolveAgentService: ResolveAgentService,
  ) {}

  /** Disables or re-enables one route of a virtual model, tier or category chain. */
  @Patch(':agentName/route-status')
  async setDisabled(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Body() body: SetRouteDisabledRequest,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    await this.routeStatus.setDisabled(agent.id, body);
    return { ok: true };
  }
}
