import { ReliabilityStatsService } from './reliability-stats.service';

const queryBuilder = () => {
  const qb = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    leftJoin: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
  };
  for (const key of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'leftJoin',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'limit',
  ] as const) {
    qb[key].mockReturnValue(qb);
  }
  return qb;
};

describe('ReliabilityStatsService', () => {
  const messageRepo = { createQueryBuilder: jest.fn() };
  const emptyTotals = { total: 0, success: 0, fallback: 0, error: 0 };
  const requestVolume = {
    getDispositionTimeseries: jest.fn().mockResolvedValue([]),
    getDispositionTotalsForWindows: jest.fn(),
    getVolumeByDimension: jest.fn().mockResolvedValue([]),
  };
  let service: ReliabilityStatsService;

  beforeEach(() => {
    jest.clearAllMocks();
    messageRepo.createQueryBuilder.mockReset();
    requestVolume.getDispositionTimeseries.mockResolvedValue([]);
    requestVolume.getDispositionTotalsForWindows.mockResolvedValue({
      current: emptyTotals,
      previous: emptyTotals,
    });
    requestVolume.getVolumeByDimension.mockResolvedValue([]);
    service = new ReliabilityStatsService(messageRepo as never, requestVolume as never);
  });

  it('computes request reliability stats for the current and previous windows', async () => {
    // ONE terminal-CTE scan yields both windows; getStats derives the KPI
    // counts from that single result instead of scanning twice.
    requestVolume.getDispositionTotalsForWindows.mockResolvedValue({
      current: { total: 10, success: 7, fallback: 1, error: 2 },
      previous: { total: 4, success: 2, fallback: 0, error: 2 },
    });

    await expect(
      service.getStats({ tenantId: 'tenant', range: '30d', agentName: 'agent' }),
    ).resolves.toEqual({
      success_rate: { value: 0.8, previous: 0.5 },
      fallback_saves: { value: 1, previous: 0 },
      total_requests: { value: 10, previous: 4 },
      errors_remaining: { value: 2, previous: 2 },
    });
    expect(requestVolume.getDispositionTotalsForWindows).toHaveBeenCalledTimes(1);
    expect(requestVolume.getDispositionTotalsForWindows).toHaveBeenCalledWith({
      tenantId: 'tenant',
      from: expect.any(String),
      splitAt: expect.any(String),
      to: expect.any(String),
      agentName: 'agent',
    });
    // The stats never scan attempts directly.
    expect(messageRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('reports a zero success rate for an idle window', async () => {
    await expect(service.getStats({ tenantId: 'tenant' })).resolves.toEqual({
      success_rate: { value: 0, previous: 0 },
      fallback_saves: { value: 0, previous: 0 },
      total_requests: { value: 0, previous: 0 },
      errors_remaining: { value: 0, previous: 0 },
    });
  });

  it('maps per-provider, per-agent and per-model reliability rows', async () => {
    // Provider and model tables live in the ATTEMPT world: every provider
    // call counts by its own outcome.
    const providerQb = queryBuilder();
    providerQb.getRawMany.mockResolvedValue([
      {
        provider: 'openai',
        auth_type: 'subscription',
        key_label: 'Default',
        attempts: '12',
        failed: '3',
        succeeded: '9',
      },
    ]);
    requestVolume.getVolumeByDimension.mockResolvedValue([
      { key: 'demo', requests: 8, failed: 2, fallback: 2, succeeded: 6 },
    ]);
    messageRepo.createQueryBuilder.mockReturnValueOnce(providerQb);

    await expect(
      service.getPerProviderStats({ tenantId: 'tenant', agentName: 'demo' }),
    ).resolves.toEqual([
      {
        provider: 'openai',
        auth_type: 'subscription',
        key_label: 'Default',
        attempts: 12,
        failed: 3,
        succeeded: 9,
      },
    ]);
    // Connection grain: grouped by provider + folded auth_type + folded label.
    const providerGroupSql = providerQb.addGroupBy.mock.calls.flat().join(' ');
    expect(providerGroupSql).toContain("COALESCE(at.auth_type, 'api_key')");
    expect(providerGroupSql).toContain("COALESCE(at.provider_key_label, 'Default')");
    const providerSql = providerQb.addSelect.mock.calls.flat().join(' ');
    // Canonical success and legacy NULL/ok remain compatible.
    expect(providerSql).toContain("at.status IN ('ok', 'success')");
    expect(providerSql).toContain("at.status NOT IN ('pending', 'cancelled', 'ok', 'success')");

    // The harness table stays in the REQUEST world.
    await expect(service.getPerAgentStats({ tenantId: 'tenant' })).resolves.toEqual([
      { agent_name: 'demo', requests: 8, failed: 2, fallback_saves: 2, succeeded: 6 },
    ]);
    expect(requestVolume.getVolumeByDimension).toHaveBeenCalledWith('agent_name', {
      tenantId: 'tenant',
    });

    const modelQb = queryBuilder();
    modelQb.getRawMany.mockResolvedValue([
      { model: 'gpt-4o', attempts: '6', failed: '1', succeeded: '5' },
    ]);
    messageRepo.createQueryBuilder.mockReturnValueOnce(modelQb);
    await expect(
      service.getPerModelStats({ tenantId: 'tenant', agentName: 'demo' }),
    ).resolves.toEqual([{ model: 'gpt-4o', attempts: 6, failed: 1, succeeded: 5 }]);
  });

  it('builds hourly failed-only timeseries and preserves disposition order', async () => {
    // #2511: the disposition dimension counts logical requests via the
    // request-volume service (terminal-attempt attribution), not attempts.
    requestVolume.getDispositionTimeseries.mockResolvedValue([
      { bucket: '2026-01-01 10:00:00', dim: 'error', count: '2' },
      { bucket: '2026-01-01 10:00:00', dim: 'fallback', count: '1' },
      { bucket: '2026-01-01 10:00:00', dim: 'success', count: '5' },
      { bucket: '2026-01-01 11:00:00', dim: 'success', count: '1' },
      { bucket: '2026-01-01 10:00:00', dim: null, count: '3' },
    ]);

    await expect(
      service.getTimeseries({
        tenantId: 'tenant',
        range: '24h',
        by: 'invalid',
        failedOnly: true,
      }),
    ).resolves.toEqual({
      range: '24h',
      by: 'disposition',
      keys: ['success', 'fallback', 'error', 'unknown'],
      buckets: [
        { bucket: '2026-01-01 10:00:00', counts: [5, 1, 2, 3] },
        { bucket: '2026-01-01 11:00:00', counts: [1, 0, 0, 0] },
      ],
    });
    expect(requestVolume.getDispositionTimeseries).toHaveBeenCalledWith({
      tenantId: 'tenant',
      range: '24h',
      hourly: true,
      agentName: undefined,
      failedOnly: true,
    });
    // The disposition path never scans attempts directly.
    expect(messageRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it.each(['http_status', 'provider', 'error_kind'])(
    'supports the %s timeseries dimension',
    async (by) => {
      const qb = queryBuilder();
      qb.getRawMany.mockResolvedValue([
        { bucket: '2026-01-02', dim: 'zeta', count: '1' },
        { bucket: '2026-01-01', dim: 'alpha', count: '2' },
      ]);
      messageRepo.createQueryBuilder.mockReturnValue(qb);
      const result = await service.getTimeseries({ tenantId: null, range: '7d', by });
      expect(result.by).toBe(by);
      expect(result.keys).toEqual(['alpha', 'zeta']);
      expect(result.buckets[0]!.bucket).toBe('2026-01-01');
      expect(qb.addSelect.mock.calls[0]![0]).toEqual(expect.any(String));
    },
  );

  it('falls back to the disposition view for a dimension it no longer serves', async () => {
    const result = await service.getTimeseries({ tenantId: 'tenant', range: '7d', by: 'healed' });

    expect(result.by).toBe('disposition');
    expect(requestVolume.getDispositionTimeseries).toHaveBeenCalled();
  });

  it('derives window counts from the request-level disposition totals', () => {
    const internals = service as unknown as {
      windowCounts: (t: {
        total: number;
        success: number;
        fallback: number;
        error: number;
      }) => unknown;
    };
    // ONE definition: the KPI window reads the same reducer as the chart.
    expect(internals.windowCounts({ total: 100, success: 74, fallback: 6, error: 20 })).toEqual({
      total: 100,
      successes: 80, // success + recovered by fallback
      fallback_saves: 6,
      errors: 20,
    });
  });
});
