import { Test, TestingModule } from '@nestjs/testing';
import { NotificationCronService } from './notification-cron.service';
import { NotificationRulesService } from './notification-rules.service';
import { NotificationLogService } from './notification-log.service';
import { TriggerSignalService } from '../../common/services/trigger-signal.service';

const activeRule = {
  id: 'rule-1',
  tenant_id: 'tenant-1',
  agent_name: 'my-agent',
  metric_type: 'tokens' as const,
  threshold: 100000,
  period: 'day' as const,
};

describe('NotificationCronService', () => {
  let service: NotificationCronService;
  let mockGetAllActiveRules: jest.Mock;
  let mockGetConsumption: jest.Mock;
  let mockHasAlreadySent: jest.Mock;
  let mockInsertLog: jest.Mock;
  let mockEmit: jest.Mock;

  beforeEach(async () => {
    mockGetAllActiveRules = jest.fn();
    mockGetConsumption = jest.fn();
    mockHasAlreadySent = jest.fn().mockResolvedValue(false);
    mockInsertLog = jest.fn().mockResolvedValue(undefined);
    mockEmit = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationCronService,
        {
          provide: NotificationRulesService,
          useValue: {
            getAllActiveRules: mockGetAllActiveRules,
            getActiveRulesForTenant: jest.fn().mockResolvedValue([]),
            getConsumption: mockGetConsumption,
          },
        },
        {
          provide: NotificationLogService,
          useValue: { hasAlreadySent: mockHasAlreadySent, insertLog: mockInsertLog },
        },
        { provide: TriggerSignalService, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get(NotificationCronService);
  });

  it('returns 0 when no active rules', async () => {
    mockGetAllActiveRules.mockResolvedValue([]);
    const result = await service.checkThresholds();
    expect(result).toBe(0);
  });

  it('onModuleInit calls checkThresholds for startup catch-up', async () => {
    mockGetAllActiveRules.mockResolvedValue([]);
    const spy = jest.spyOn(service, 'checkThresholds');
    await service.onModuleInit();
    expect(spy).toHaveBeenCalled();
  });

  it('onModuleInit does not throw on error', async () => {
    mockGetAllActiveRules.mockRejectedValue(new Error('DB not ready'));
    await expect(service.onModuleInit()).resolves.not.toThrow();
  });

  it('onModuleInit logs startup catch-up count when triggers occur', async () => {
    mockGetAllActiveRules.mockResolvedValue([activeRule]);
    mockGetConsumption.mockResolvedValue(200000);

    const loggerSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
    await service.onModuleInit();

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Startup catch-up: 1 notification(s) triggered'),
    );
    loggerSpy.mockRestore();
  });

  it('skips rule when consumption fetch fails', async () => {
    mockGetAllActiveRules.mockResolvedValue([activeRule]);
    mockGetConsumption.mockRejectedValue(new Error('DB timeout'));

    const loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
    const result = await service.checkThresholds();
    expect(result).toBe(0);
    expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Error fetching consumption'));
    loggerSpy.mockRestore();
  });

  it('skips rule when already notified for current period (dedup)', async () => {
    mockGetAllActiveRules.mockResolvedValue([activeRule]);
    mockGetConsumption.mockResolvedValue(200000);
    mockHasAlreadySent.mockResolvedValue(true);

    const result = await service.checkThresholds();
    expect(result).toBe(0);
    expect(mockInsertLog).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('does not trigger when consumption is below threshold', async () => {
    mockGetAllActiveRules.mockResolvedValue([activeRule]);
    mockGetConsumption.mockResolvedValue(50000);

    const result = await service.checkThresholds();
    expect(result).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('triggers notification when consumption exceeds threshold', async () => {
    mockGetAllActiveRules.mockResolvedValue([activeRule]);
    mockGetConsumption.mockResolvedValue(150000);

    const result = await service.checkThresholds();
    expect(result).toBe(1);
    expect(mockInsertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: 'rule-1',
        actualValue: 150000,
        thresholdValue: 100000,
        metricType: 'tokens',
        agentName: 'my-agent',
      }),
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith({
      kind: 'limit',
      alertType: 'soft',
      tenantId: 'tenant-1',
      agentName: 'my-agent',
      ruleId: 'rule-1',
      metric: 'tokens',
      threshold: 100000,
      actual: 150000,
      period: 'day',
      periodStart: mockInsertLog.mock.calls[0][0].periodStart,
      periodEnd: mockInsertLog.mock.calls[0][0].periodEnd,
    });
    // Soft alerts carry no reset date.
    expect(mockEmit.mock.calls[0][0]).not.toHaveProperty('periodReset');
    // The log row is written before the signal goes out.
    expect(mockInsertLog.mock.invocationCallOrder[0]).toBeLessThan(
      mockEmit.mock.invocationCallOrder[0],
    );
  });

  it('handles multiple rules and counts only triggered ones', async () => {
    const rule2 = { ...activeRule, id: 'rule-2', threshold: 500000 };
    mockGetAllActiveRules.mockResolvedValue([activeRule, rule2]);
    mockGetConsumption.mockResolvedValueOnce(150000);

    const result = await service.checkThresholds();
    expect(result).toBe(1);
  });

  it('triggers notification for hourly period', async () => {
    const hourlyRule = { ...activeRule, id: 'rule-hour', period: 'hour' as const };
    mockGetAllActiveRules.mockResolvedValue([hourlyRule]);
    mockGetConsumption.mockResolvedValue(150000);

    const result = await service.checkThresholds();
    expect(result).toBe(1);
    expect(mockEmit).toHaveBeenCalled();
  });

  it('triggers notification for weekly period', async () => {
    const weeklyRule = { ...activeRule, id: 'rule-week', period: 'week' as const };
    mockGetAllActiveRules.mockResolvedValue([weeklyRule]);
    mockGetConsumption.mockResolvedValue(150000);

    const result = await service.checkThresholds();
    expect(result).toBe(1);
  });

  it('triggers notification for monthly period', async () => {
    const monthlyRule = { ...activeRule, id: 'rule-month', period: 'month' as const };
    mockGetAllActiveRules.mockResolvedValue([monthlyRule]);
    mockGetConsumption.mockResolvedValue(150000);

    const result = await service.checkThresholds();
    expect(result).toBe(1);
  });

  it('continues processing remaining rules when one throws', async () => {
    const rule2 = { ...activeRule, id: 'rule-2' };
    mockGetAllActiveRules.mockResolvedValue([activeRule, rule2]);
    mockGetConsumption.mockResolvedValueOnce(200000);

    mockHasAlreadySent.mockRejectedValueOnce(new Error('DB down')).mockResolvedValueOnce(false);

    const result = await service.checkThresholds();
    expect(result).toBe(1);
  });
});
