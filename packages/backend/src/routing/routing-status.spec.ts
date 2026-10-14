import { resolveRoutingStatus } from './routing-status';

describe('resolveRoutingStatus (#75)', () => {
  const previous = process.env['THINKER_CATALOG_SYNC'];
  afterEach(() => {
    if (previous === undefined) delete process.env['THINKER_CATALOG_SYNC'];
    else process.env['THINKER_CATALOG_SYNC'] = previous;
  });

  const active = [{ is_active: true }];

  it('reports no_provider without an active connection, before anything else', async () => {
    const hasRoutableTier = jest.fn().mockResolvedValue(true);
    await expect(
      resolveRoutingStatus({
        providers: [{ is_active: false }],
        hasRoutableTier,
        pricingCacheSize: () => 0,
      }),
    ).resolves.toEqual({ enabled: false, reason: 'no_provider' });
    expect(hasRoutableTier).not.toHaveBeenCalled();
  });

  it('routes when a tier resolves, even with an empty pricing cache', async () => {
    await expect(
      resolveRoutingStatus({
        providers: active,
        hasRoutableTier: async () => true,
        pricingCacheSize: () => 0,
      }),
    ).resolves.toEqual({ enabled: true, reason: null });
  });

  it('blames the empty pricing cache only for an agent that cannot route', async () => {
    delete process.env['THINKER_CATALOG_SYNC'];
    await expect(
      resolveRoutingStatus({
        providers: active,
        hasRoutableTier: async () => false,
        pricingCacheSize: () => 0,
      }),
    ).resolves.toEqual({ enabled: false, reason: 'pricing_cache_empty' });
    await expect(
      resolveRoutingStatus({
        providers: active,
        hasRoutableTier: async () => false,
        pricingCacheSize: () => 3,
      }),
    ).resolves.toEqual({ enabled: false, reason: 'no_routable_models' });
  });

  it('does not blame the cache with THINKER_CATALOG_SYNC=false', async () => {
    process.env['THINKER_CATALOG_SYNC'] = 'off';
    await expect(
      resolveRoutingStatus({
        providers: active,
        hasRoutableTier: async () => false,
        pricingCacheSize: () => 0,
      }),
    ).resolves.toEqual({ enabled: false, reason: 'no_routable_models' });
  });
});
