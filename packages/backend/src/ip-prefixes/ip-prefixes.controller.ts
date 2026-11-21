import { Audit } from '../alerts/audit.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { MinRole } from '../common/decorators/roles.decorator';
import { TenantCacheService } from '../common/services/tenant-cache.service';
import { IpPrefixesService, type IpPrefixListInput } from './ip-prefixes.service';

/**
 * IP prefix lists and the per-key source-IP restriction. Owners and
 * admins only, like the proxy servers: they describe the workspace's network.
 */
@MinRole('admin', { includeReads: true })
@Controller('api/v1')
export class IpPrefixesController {
  constructor(
    private readonly lists: IpPrefixesService,
    private readonly tenantCache: TenantCacheService,
  ) {}

  @Get('ip-prefix-lists')
  list(@TenantCtx() ctx: TenantContext) {
    return this.lists.list(ctx.tenantId);
  }

  @Get('ip-prefix-lists/:id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.lists.get(ctx.tenantId, id);
  }

  @Audit({ entity: 'ip_prefix_list', action: 'created' })
  @Post('ip-prefix-lists')
  async create(@TenantCtx() ctx: TenantContext, @Body() body: IpPrefixListInput) {
    const tenantId = ctx.tenantId ?? (await this.tenantCache.ensureForUser(ctx.userId!));
    return this.lists.create(tenantId, ctx.userId, body ?? {});
  }

  @Audit({
    entity: 'ip_prefix_list',
    action: 'updated',
    lookup: { table: 'ip_prefix_lists', nameColumn: 'name' },
  })
  @Patch('ip-prefix-lists/:id')
  update(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: IpPrefixListInput,
  ) {
    return this.lists.update(ctx.tenantId, id, body ?? {});
  }

  @Audit({
    entity: 'ip_prefix_list',
    action: 'deleted',
    lookup: { table: 'ip_prefix_lists', nameColumn: 'name' },
  })
  @Delete('ip-prefix-lists/:id')
  remove(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.lists.remove(ctx.tenantId, id);
  }

  @Get('agents/:agentName/keys/:keyId/ip-restriction')
  getRestriction(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('keyId') keyId: string,
  ) {
    return this.lists.getRestriction(ctx.tenantId, agentName, keyId);
  }

  @Audit({ entity: 'harness', action: 'updated', idParam: 'agentName', nameParams: ['agentName'] })
  @Put('agents/:agentName/keys/:keyId/ip-restriction')
  setRestriction(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('keyId') keyId: string,
    @Body() body: { enabled?: unknown; listIds?: unknown },
  ) {
    return this.lists.setRestriction(ctx.tenantId, agentName, keyId, body ?? {});
  }
}
