import { Controller, Get, Query } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { MinRole } from '../common/decorators/roles.decorator';
import { ConsoleService } from './console.service';

/** Topbar search (⌘K) and alerts bell of the dashboard. */
@Controller('api/v1')
@MinRole('viewer')
export class ConsoleController {
  constructor(private readonly consoleService: ConsoleService) {}

  @Get('search')
  async search(@TenantCtx() ctx: TenantContext, @Query('q') q?: string) {
    if (!ctx.tenantId) return { results: [] };
    return { results: await this.consoleService.search(ctx.tenantId, q ?? '') };
  }

  @Get('alerts')
  async alerts(@TenantCtx() ctx: TenantContext) {
    if (!ctx.tenantId) return { items: [], total: 0 };
    return this.consoleService.alerts(ctx.tenantId);
  }
}
