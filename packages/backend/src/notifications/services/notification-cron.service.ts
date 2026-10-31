import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationRulesService } from './notification-rules.service';
import { NotificationLogService, formatNotificationTimestamp } from './notification-log.service';
import { TriggerSignalService } from '../../common/services/trigger-signal.service';
import { computePeriodBoundaries } from '../../common/utils/period.util';

interface ActiveRule {
  id: string;
  tenant_id: string;
  agent_name: string;
  metric_type: 'tokens' | 'cost';
  threshold: number;
  period: 'hour' | 'day' | 'week' | 'month';
}

@Injectable()
export class NotificationCronService implements OnModuleInit {
  private readonly logger = new Logger(NotificationCronService.name);

  constructor(
    private readonly rulesService: NotificationRulesService,
    private readonly notificationLog: NotificationLogService,
    private readonly triggerSignals: TriggerSignalService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const triggered = await this.checkThresholds();
      if (triggered > 0) {
        this.logger.log(`Startup catch-up: ${triggered} notification(s) triggered`);
      }
    } catch (err) {
      this.logger.error(`Startup catch-up failed: ${err}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkThresholds(tenantId?: string): Promise<number> {
    const rules: ActiveRule[] = tenantId
      ? await this.rulesService.getActiveRulesForTenant(tenantId)
      : await this.rulesService.getAllActiveRules();
    if (!rules.length) return 0;

    this.logger.log(`Checking ${rules.length} notification rules...`);

    // Group rules by (tenant_id, agent_name, period) to deduplicate consumption queries
    const groups = new Map<string, { rules: ActiveRule[]; consumption: Map<string, number> }>();
    for (const rule of rules) {
      const key = `${rule.tenant_id}|${rule.agent_name}|${rule.period}`;
      if (!groups.has(key)) groups.set(key, { rules: [], consumption: new Map() });
      groups.get(key)!.rules.push(rule);
    }

    // Fetch consumption once per group+metric combination
    for (const [, group] of groups) {
      const sample = group.rules[0];
      const { periodStart, periodEnd } = computePeriodBoundaries(sample.period);
      const metrics = new Set(group.rules.map((r) => r.metric_type));
      for (const metric of metrics) {
        try {
          const value = await this.rulesService.getConsumption(
            sample.tenant_id,
            sample.agent_name,
            metric,
            periodStart,
            periodEnd,
          );
          group.consumption.set(metric, value);
        } catch (err) {
          this.logger.error(
            `Error fetching consumption for ${sample.agent_name}/${metric}: ${err}`,
          );
        }
      }
    }

    // Evaluate rules against pre-fetched consumption
    let triggered = 0;
    for (const [, group] of groups) {
      for (const rule of group.rules) {
        try {
          const actual = group.consumption.get(rule.metric_type);
          if (actual === undefined) continue;
          const sent = await this.evaluateRule(rule, actual);
          if (sent) triggered++;
        } catch (err) {
          this.logger.error(`Error evaluating rule ${rule.id}: ${err}`);
        }
      }
    }

    if (triggered > 0) {
      this.logger.log(`${triggered} notification(s) triggered`);
    }
    return triggered;
  }

  private async evaluateRule(rule: ActiveRule, actual: number): Promise<boolean> {
    const { periodStart, periodEnd } = computePeriodBoundaries(rule.period);

    if (await this.notificationLog.hasAlreadySent(rule.id, periodStart)) return false;
    if (actual < rule.threshold) return false;

    const now = formatNotificationTimestamp();
    await this.notificationLog.insertLog({
      ruleId: rule.id,
      periodStart,
      periodEnd,
      actualValue: actual,
      thresholdValue: rule.threshold,
      metricType: rule.metric_type,
      agentName: rule.agent_name,
      sentAt: now,
    });

    // Delivery goes through the harness's event triggers (limit.alert).
    this.triggerSignals.emit({
      kind: 'limit',
      tenantId: rule.tenant_id,
      agentName: rule.agent_name,
      alertType: 'soft',
      ruleId: rule.id,
      metric: rule.metric_type,
      threshold: Number(rule.threshold),
      actual,
      period: rule.period,
      periodStart,
      periodEnd,
    });

    return true;
  }
}
