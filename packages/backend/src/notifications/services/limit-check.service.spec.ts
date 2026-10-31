import { LimitCheckService } from './limit-check.service';
import { NotificationRulesService } from './notification-rules.service';
import { NotificationLogService } from './notification-log.service';
import { TriggerSignalService } from '../../common/services/trigger-signal.service';

describe('LimitCheckService', () => {
  let service: LimitCheckService;
  let mockGetActiveBlockRules: jest.Mock;
  let mockGetConsumption: jest.Mock;
  let mockHasAlreadySent: jest.Mock;
  let mockInsertLog: jest.Mock;
  let mockEmit: jest.Mock;

  beforeEach(() => {
    mockGetActiveBlockRules = jest.fn().mockResolvedValue([]);
    mockGetConsumption = jest.fn().mockResolvedValue(0);

    const rulesService = {
      getActiveBlockRules: mockGetActiveBlockRules,
      getConsumption: mockGetConsumption,
    } as unknown as NotificationRulesService;

    mockHasAlreadySent = jest.fn().mockResolvedValue(false);
    mockInsertLog = jest.fn().mockResolvedValue(undefined);
    const notificationLog = {
      hasAlreadySent: mockHasAlreadySent,
      insertLog: mockInsertLog,
    } as unknown as NotificationLogService;

    mockEmit = jest.fn();
    const triggerSignals = { emit: mockEmit } as unknown as TriggerSignalService;

    service = new LimitCheckService(rulesService, notificationLog, triggerSignals);
  });

  it('returns null when no block rules exist', async () => {
    const result = await service.checkLimits('tenant-1', 'my-agent');
    expect(result).toBeNull();
  });

  it('returns null when consumption is below threshold', async () => {
    mockGetActiveBlockRules.mockResolvedValue([
      {
        id: 'r1',
        tenant_id: 'tenant-1',
        agent_name: 'my-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
      },
    ]);
    mockGetConsumption.mockResolvedValue(30000);

    const result = await service.checkLimits('tenant-1', 'my-agent');
    expect(result).toBeNull();
  });

  it('returns LimitExceeded when consumption meets threshold', async () => {
    mockGetActiveBlockRules.mockResolvedValue([
      {
        id: 'r1',
        tenant_id: 'tenant-1',
        agent_name: 'my-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
      },
    ]);
    mockGetConsumption.mockResolvedValue(50000);

    const result = await service.checkLimits('tenant-1', 'my-agent');
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('r1');
    expect(result!.metricType).toBe('tokens');
    expect(result!.threshold).toBe(50000);
    expect(result!.actual).toBe(50000);
  });

  it('returns LimitExceeded when consumption exceeds threshold', async () => {
    mockGetActiveBlockRules.mockResolvedValue([
      {
        id: 'r1',
        tenant_id: 'tenant-1',
        agent_name: 'my-agent',
        metric_type: 'cost',
        threshold: 10,
        period: 'month',
      },
    ]);
    mockGetConsumption.mockResolvedValue(15.5);

    const result = await service.checkLimits('tenant-1', 'my-agent');
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('cost');
    expect(result!.actual).toBe(15.5);
  });

  it('returns first exceeded rule when multiple rules exist', async () => {
    mockGetActiveBlockRules.mockResolvedValue([
      {
        id: 'r1',
        tenant_id: 't',
        agent_name: 'a',
        metric_type: 'tokens',
        threshold: 100000,
        period: 'day',
      },
      {
        id: 'r2',
        tenant_id: 't',
        agent_name: 'a',
        metric_type: 'cost',
        threshold: 5,
        period: 'day',
      },
    ]);
    mockGetConsumption
      .mockResolvedValueOnce(50000) // below r1 threshold
      .mockResolvedValueOnce(10); // above r2 threshold

    const result = await service.checkLimits('t', 'a');
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('r2');
  });

  it('reuses consumption for rules with the same metric and period within one request', async () => {
    mockGetActiveBlockRules.mockResolvedValue([
      {
        id: 'r1',
        tenant_id: 't',
        agent_name: 'a',
        metric_type: 'tokens',
        threshold: 100000,
        period: 'day',
      },
      {
        id: 'r2',
        tenant_id: 't',
        agent_name: 'a',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
      },
    ]);
    mockGetConsumption.mockResolvedValue(75000);

    await expect(service.checkLimits('t', 'a')).resolves.toEqual(
      expect.objectContaining({ ruleId: 'r2', actual: 75000 }),
    );
    expect(mockGetConsumption).toHaveBeenCalledTimes(1);
  });

  describe('window fixed once per request', () => {
    afterEach(() => jest.useRealTimers());

    const sameMetricRules = [
      {
        id: 'r1',
        tenant_id: 't',
        agent_name: 'a',
        metric_type: 'tokens',
        threshold: 100000,
        period: 'day',
      },
      {
        id: 'r2',
        tenant_id: 't',
        agent_name: 'a',
        metric_type: 'tokens',
        threshold: 90000,
        period: 'day',
      },
    ];

    // periodEnd carries milliseconds, so a slow consumption query moves "now"
    // before the next rule is read. The stub advances the clock on every call
    // to make that deterministic: recomputing the window per rule would miss
    // the reuse and query twice.
    const slowConsumption = (value: number) => async () => {
      jest.setSystemTime(Date.now() + 37);
      return value;
    };

    it('queries once for two same-metric/period rules even when the query is slow', async () => {
      jest.useFakeTimers({ now: new Date(2026, 5, 10, 11, 16, 0, 100) });
      mockGetActiveBlockRules.mockResolvedValue(sameMetricRules);
      mockGetConsumption.mockImplementation(slowConsumption(75000));

      await expect(service.checkLimits('t', 'a')).resolves.toBeNull();

      expect(mockGetConsumption).toHaveBeenCalledTimes(1);
      expect(mockGetConsumption).toHaveBeenCalledWith(
        't',
        'a',
        'tokens',
        '2026-06-10 00:00:00',
        '2026-06-10 11:16:00.100',
      );
    });

    it('still queries separately per period and per metric', async () => {
      jest.useFakeTimers({ now: new Date(2026, 5, 10, 11, 16, 0, 100) });
      mockGetActiveBlockRules.mockResolvedValue([
        ...sameMetricRules,
        { ...sameMetricRules[0], id: 'r3', period: 'month' },
        { ...sameMetricRules[0], id: 'r4', metric_type: 'cost', threshold: 1000 },
      ]);
      mockGetConsumption.mockImplementation(slowConsumption(10));

      await expect(service.checkLimits('t', 'a')).resolves.toBeNull();

      expect(mockGetConsumption).toHaveBeenCalledTimes(3);
      const windows = mockGetConsumption.mock.calls.map((c) => `${c[2]}|${c[3]}|${c[4]}`);
      expect(windows).toEqual([
        'tokens|2026-06-10 00:00:00|2026-06-10 11:16:00.100',
        'tokens|2026-06-01 00:00:00|2026-06-10 11:16:00.100',
        'cost|2026-06-10 00:00:00|2026-06-10 11:16:00.100',
      ]);
    });
  });

  it('enforces a block rule created through another replica on the next request', async () => {
    await expect(service.checkLimits('tenant-1', 'my-agent')).resolves.toBeNull();

    mockGetActiveBlockRules.mockResolvedValue([
      {
        id: 'new-rule',
        tenant_id: 'tenant-1',
        agent_name: 'my-agent',
        metric_type: 'tokens',
        threshold: 100,
        period: 'day',
      },
    ]);
    mockGetConsumption.mockResolvedValue(100);

    await expect(service.checkLimits('tenant-1', 'my-agent')).resolves.toEqual(
      expect.objectContaining({ ruleId: 'new-rule', actual: 100 }),
    );
    expect(mockGetActiveBlockRules).toHaveBeenCalledTimes(2);
  });

  it('uses current consumption on every request', async () => {
    mockGetActiveBlockRules.mockResolvedValue([
      {
        id: 'r1',
        tenant_id: 'tenant-1',
        agent_name: 'my-agent',
        metric_type: 'tokens',
        threshold: 100,
        period: 'day',
      },
    ]);
    mockGetConsumption.mockResolvedValueOnce(99).mockResolvedValueOnce(100);

    await expect(service.checkLimits('tenant-1', 'my-agent')).resolves.toBeNull();
    await expect(service.checkLimits('tenant-1', 'my-agent')).resolves.toEqual(
      expect.objectContaining({ ruleId: 'r1', actual: 100 }),
    );
    expect(mockGetConsumption).toHaveBeenCalledTimes(2);
  });

  describe('limit signal on block', () => {
    const rule = {
      id: 'r1',
      tenant_id: 'tenant-1',
      agent_name: 'my-agent',
      metric_type: 'tokens' as const,
      threshold: 50000,
      period: 'day' as const,
    };

    beforeEach(() => {
      mockGetActiveBlockRules.mockResolvedValue([rule]);
      mockGetConsumption.mockResolvedValue(60000);
    });

    it('logs and emits a hard limit signal when limit exceeded first time', async () => {
      await service.checkLimits('tenant-1', 'my-agent');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockInsertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: 'r1',
          actualValue: 60000,
          thresholdValue: 50000,
          metricType: 'tokens',
          agentName: 'my-agent',
        }),
      );
      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith({
        kind: 'limit',
        alertType: 'hard',
        tenantId: 'tenant-1',
        agentName: 'my-agent',
        ruleId: 'r1',
        metric: 'tokens',
        threshold: 50000,
        actual: 60000,
        period: 'day',
        periodStart: expect.any(String),
        periodEnd: expect.any(String),
        periodReset: expect.any(String),
      });
      // The signal carries the same window that was written to the log.
      const logged = mockInsertLog.mock.calls[0][0];
      const signal = mockEmit.mock.calls[0][0];
      expect(signal.periodStart).toBe(logged.periodStart);
      expect(signal.periodEnd).toBe(logged.periodEnd);
      expect(mockHasAlreadySent).toHaveBeenCalledWith('r1', logged.periodStart);
    });

    it('neither logs nor emits when already notified for this period', async () => {
      mockHasAlreadySent.mockResolvedValue(true);
      const result = await service.checkLimits('tenant-1', 'my-agent');
      await new Promise((r) => setTimeout(r, 50));
      // The request is still blocked.
      expect(result).toEqual(expect.objectContaining({ ruleId: 'r1' }));
      expect(mockInsertLog).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('catches and logs error in notifyLimitExceeded', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
      mockHasAlreadySent.mockRejectedValue(new Error('DB down'));
      await service.checkLimits('tenant-1', 'my-agent');
      await new Promise((r) => setTimeout(r, 50));
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send block notification'),
      );
      expect(mockEmit).not.toHaveBeenCalled();
      loggerSpy.mockRestore();
    });

    it('includes period field in returned LimitExceeded', async () => {
      const result = await service.checkLimits('tenant-1', 'my-agent');
      expect(result).not.toBeNull();
      expect(result!.period).toBe('day');
    });
  });
});
