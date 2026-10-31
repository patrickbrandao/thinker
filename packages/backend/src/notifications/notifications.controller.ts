import { Controller, Get, Post, Patch, Delete, Query, Param, Body, Logger } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { NotificationRulesService } from './services/notification-rules.service';
import { NotificationLogService } from './services/notification-log.service';
import { NotificationCronService } from './services/notification-cron.service';
import { CreateNotificationRuleDto, UpdateNotificationRuleDto } from './dto/notification-rule.dto';
import { MinRole } from '../common/decorators/roles.decorator';

@MinRole('admin')
@Controller('api/v1/notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly rulesService: NotificationRulesService,
    private readonly notificationLog: NotificationLogService,
    private readonly cronService: NotificationCronService,
  ) {}

  @Post('trigger-check')
  async triggerCheck(@TenantCtx() ctx: TenantContext) {
    this.logger.log('Manual notification check triggered');
    const triggered = await this.cronService.checkThresholds(ctx.tenantId ?? undefined);
    return { triggered, message: `${triggered} notification(s) triggered` };
  }

  @Get('logs')
  async getLogs(@Query('agent_name') agentName: string, @TenantCtx() ctx: TenantContext) {
    return this.notificationLog.getLogsForAgent(ctx.tenantId, agentName);
  }

  @Get()
  async listRules(@Query('agent_name') agentName: string, @TenantCtx() ctx: TenantContext) {
    return this.rulesService.listRules(ctx.tenantId, agentName);
  }

  @Post()
  async createRule(@Body() dto: CreateNotificationRuleDto, @TenantCtx() ctx: TenantContext) {
    return this.rulesService.createRule(ctx.tenantId, dto);
  }

  @Patch(':id')
  async updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationRuleDto,
    @TenantCtx() ctx: TenantContext,
  ) {
    return this.rulesService.updateRule(ctx.tenantId, id, dto);
  }

  @Delete(':id')
  async deleteRule(@Param('id') id: string, @TenantCtx() ctx: TenantContext) {
    await this.rulesService.deleteRule(ctx.tenantId, id);
    return { deleted: true };
  }
}
