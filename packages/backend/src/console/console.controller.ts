import { Body, Controller, Delete, Get, HttpCode, Put, Query } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { MinRole } from '../common/decorators/roles.decorator';
import { ConsoleService } from './console.service';
import { TOPOLOGY_RANGES, TopologyService, type TopologyRange } from './topology.service';

/** Topbar search (⌘K), alerts bell and topology view of the dashboard. */
@Controller('api/v1')
@MinRole('viewer')
export class ConsoleController {
  constructor(
    private readonly consoleService: ConsoleService,
    private readonly topologyService: TopologyService,
  ) {}

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

  @Get('topology')
  async topology(@TenantCtx() ctx: TenantContext, @Query('range') range?: string) {
    const window: TopologyRange =
      range && range in TOPOLOGY_RANGES ? (range as TopologyRange) : '24h';
    if (!ctx.tenantId) {
      return {
        range: window,
        clients: [],
        harnesses: [],
        providers: [],
        proxies: [],
        egress: [],
        links: [],
        positions: {},
      };
    }
    return this.topologyService.build(ctx.tenantId, window);
  }

  @Put('topology/positions')
  @MinRole('member')
  @HttpCode(204)
  async savePositions(
    @TenantCtx() ctx: TenantContext,
    @Body() body: { positions?: Array<{ id: string; x: number; y: number }> },
  ) {
    if (!ctx.tenantId || !Array.isArray(body?.positions)) return;
    await this.topologyService.savePositions(ctx.tenantId, body.positions);
  }

  @Delete('topology/positions')
  @MinRole('member')
  @HttpCode(204)
  async resetPositions(@TenantCtx() ctx: TenantContext) {
    if (ctx.tenantId) await this.topologyService.resetPositions(ctx.tenantId);
  }
}
