import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { MinRole } from '../common/decorators/roles.decorator';
import { AlertsService, type AlertFilters } from './alerts.service';

function filters(query: Record<string, string | undefined>): AlertFilters {
  return {
    level: query.level || undefined,
    category: query.category || undefined,
    unread: query.unread === '1' || query.unread === 'true',
    page: query.page ? Number(query.page) || 1 : undefined,
    limit: query.limit ? Number(query.limit) || undefined : undefined,
  };
}

/** Alerts (system events): list, and the shared read state. */
@Controller('api/v1/alerts/events')
@MinRole('viewer')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@TenantCtx() ctx: TenantContext, @Query() query: Record<string, string | undefined>) {
    return this.alerts.list(ctx, filters(query));
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@TenantCtx() ctx: TenantContext, @Query() query: Record<string, string | undefined>) {
    return this.alerts.markAllRead(ctx, filters(query));
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.alerts.markRead(ctx, id);
  }
}
