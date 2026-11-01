import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { MinRole } from '../common/decorators/roles.decorator';
import { TenantCacheService } from '../common/services/tenant-cache.service';
import { ProxyServersService, type ProxyServerInput } from './proxy-servers.service';

/**
 * Workspace outbound proxy servers and their chains. Reading and managing
 * them is for owners and admins, like triggers: settings, logs and
 * statistics expose the workspace's network paths.
 */
@MinRole('admin', { includeReads: true })
@Controller('api/v1')
export class ProxyServersController {
  constructor(
    private readonly proxies: ProxyServersService,
    private readonly tenantCache: TenantCacheService,
  ) {}

  @Get('proxy-servers')
  list(@TenantCtx() ctx: TenantContext) {
    return this.proxies.list(ctx.tenantId);
  }

  @Get('proxy-servers/:id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.proxies.get(ctx.tenantId, id);
  }

  @Post('proxy-servers')
  async create(@TenantCtx() ctx: TenantContext, @Body() body: ProxyServerInput) {
    const tenantId = ctx.tenantId ?? (await this.tenantCache.ensureForUser(ctx.userId!));
    return this.proxies.create(tenantId, ctx.userId, body ?? {});
  }

  @Patch('proxy-servers/:id')
  update(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() body: ProxyServerInput) {
    return this.proxies.update(ctx.tenantId, id, body ?? {});
  }

  /** 409 with the bindings unless `mode` is `remove` or `replace` (+ `replace_with`). */
  @Delete('proxy-servers/:id')
  remove(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Query('mode') mode?: string,
    @Query('replace_with') replaceWith?: string,
  ) {
    return this.proxies.remove(ctx.tenantId, id, mode, replaceWith);
  }

  @Post('proxy-servers/:id/test')
  test(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { url?: unknown } | undefined,
  ) {
    return this.proxies.test(ctx.tenantId, id, body);
  }

  @Get('proxy-servers/:id/logs')
  logs(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Query()
    query: {
      result?: string;
      source_type?: string;
      from?: string;
      to?: string;
      before?: string;
      limit?: string;
    },
  ) {
    return this.proxies.logs(ctx.tenantId, id, query);
  }

  @Get('proxy-servers/:id/stats')
  stats(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Query('days') days?: string) {
    return this.proxies.stats(ctx.tenantId, id, days);
  }

  @Get('proxy-bindings/:targetType/:targetId')
  getBinding(
    @TenantCtx() ctx: TenantContext,
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
  ) {
    return this.proxies.getBinding(ctx.tenantId, targetType, targetId);
  }

  /** Body `{ chain: [proxyId | "direct", ...] }`; an empty chain removes the binding. */
  @Put('proxy-bindings/:targetType/:targetId')
  setBinding(
    @TenantCtx() ctx: TenantContext,
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
    @Body() body: unknown,
  ) {
    return this.proxies.setBinding(ctx.tenantId, targetType, targetId, body);
  }
}
