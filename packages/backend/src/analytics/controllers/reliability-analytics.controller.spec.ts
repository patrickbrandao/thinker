import { PATH_METADATA } from '@nestjs/common/constants';
import { ReliabilityAnalyticsController } from './reliability-analytics.controller';

describe('ReliabilityAnalyticsController', () => {
  const service = {
    getStats: jest.fn(),
    getTimeseries: jest.fn(),
    getPerAgentStats: jest.fn(),
    getPerProviderStats: jest.fn(),
    getPerModelStats: jest.fn(),
  };
  const controller = new ReliabilityAnalyticsController(service as never);
  const ctx = { tenantId: 'tenant' } as never;

  beforeEach(() => jest.clearAllMocks());

  it('serves every route under the neutral /api/v1/overview/reliability prefix', () => {
    const proto = ReliabilityAnalyticsController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, ReliabilityAnalyticsController)).toBe(
      'api/v1/overview/reliability',
    );
    expect(
      [
        proto.getStats,
        proto.getTimeseries,
        proto.getPerAgent,
        proto.getPerProvider,
        proto.getPerModel,
      ].map((handler) => Reflect.getMetadata(PATH_METADATA, handler)),
    ).toEqual(['stats', 'timeseries', 'per-agent', 'per-provider', 'per-model']);
  });

  it('delegates every reliability route with tenant scope', async () => {
    service.getStats.mockResolvedValue({ success_rate: { value: 1, previous: 1 } });
    service.getTimeseries.mockResolvedValue({ buckets: [] });
    service.getPerAgentStats.mockResolvedValue([]);
    service.getPerProviderStats.mockResolvedValue([]);
    service.getPerModelStats.mockResolvedValue([]);

    await controller.getStats({ range: '30d', agent_name: 'demo' }, ctx);
    await controller.getTimeseries(
      { range: '24h', agent_name: 'demo', by: 'provider', failed_only: 'true' },
      ctx,
    );
    await controller.getPerAgent({ range: '7d' }, ctx);
    await controller.getPerProvider({ range: '90d', agent_name: 'demo' }, ctx);
    await controller.getPerModel({ range: '24h', agent_name: 'demo' }, ctx);

    expect(service.getStats).toHaveBeenCalledWith({
      tenantId: 'tenant',
      range: '30d',
      agentName: 'demo',
    });
    expect(service.getTimeseries).toHaveBeenCalledWith({
      tenantId: 'tenant',
      range: '24h',
      by: 'provider',
      agentName: 'demo',
      failedOnly: true,
    });
    expect(service.getPerAgentStats).toHaveBeenCalledWith({ tenantId: 'tenant', range: '7d' });
    expect(service.getPerProviderStats).toHaveBeenCalledWith({
      tenantId: 'tenant',
      range: '90d',
      agentName: 'demo',
    });
    expect(service.getPerModelStats).toHaveBeenCalledWith({
      tenantId: 'tenant',
      range: '24h',
      agentName: 'demo',
    });
  });

  it('treats non-true failed_only values as false', async () => {
    await controller.getTimeseries({ failed_only: 'false' }, ctx);
    expect(service.getTimeseries).toHaveBeenCalledWith({
      tenantId: 'tenant',
      range: undefined,
      by: undefined,
      agentName: undefined,
      failedOnly: false,
    });
  });
});
