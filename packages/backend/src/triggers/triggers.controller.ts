import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { canUsePrivateDestinations } from '../common/utils/private-url-policy';
import { MinRole } from '../common/decorators/roles.decorator';
import { TriggersService, type TriggerTestInput } from './triggers.service';
import type { TriggerInput } from './trigger-config';

/**
 * Workspace triggers. Reading the list is open to every role (members bind
 * triggers to the harnesses they edit); managing triggers and reading the
 * delivery logs, which hold server responses, is for owners and admins.
 */
@Controller('api/v1')
export class TriggersController {
  constructor(private readonly triggers: TriggersService) {}

  @Get('triggers')
  list(@TenantCtx() ctx: TenantContext) {
    return this.triggers.list(ctx.tenantId);
  }

  @MinRole('admin', { includeReads: true })
  @Get('triggers/events')
  listEvents(
    @TenantCtx() ctx: TenantContext,
    @Query()
    query: {
      trigger_id?: string;
      status?: string;
      event_type?: string;
      agent_name?: string;
      before?: string;
      limit?: string;
    },
  ) {
    return this.triggers.listEvents(ctx.tenantId, query);
  }

  @MinRole('admin', { includeReads: true })
  @Get('triggers/events/:id')
  getEvent(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.triggers.getEvent(ctx.tenantId, id);
  }

  @MinRole('admin')
  @Post('triggers/events/:id/retry')
  retryEvent(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.triggers.retryEvent(ctx.tenantId, id);
  }

  @MinRole('admin')
  @Post('triggers')
  create(@TenantCtx() ctx: TenantContext, @Body() body: TriggerInput) {
    return this.triggers.create(ctx, body ?? {}, canUsePrivateDestinations(ctx));
  }

  @MinRole('admin')
  @Patch('triggers/:id')
  update(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() body: TriggerInput) {
    return this.triggers.update(ctx.tenantId, id, body ?? {}, canUsePrivateDestinations(ctx));
  }

  @MinRole('admin')
  @Delete('triggers/:id')
  remove(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.triggers.remove(ctx.tenantId, id);
  }

  @MinRole('admin')
  @Post('triggers/:id/test')
  test(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: TriggerTestInput | undefined,
  ) {
    return this.triggers.test(ctx.tenantId, id, ctx.userId, body ?? {});
  }

  @Get('agents/:agentName/triggers')
  getBindings(@TenantCtx() ctx: TenantContext, @Param('agentName') agentName: string) {
    return this.triggers.getBindings(ctx.tenantId, agentName);
  }

  @Put('agents/:agentName/triggers')
  setBindings(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Body() body: unknown,
  ) {
    return this.triggers.setBindings(ctx.tenantId, agentName, body);
  }
}
