import { getSubscriptionEndpointRegionConfig } from './subscription-region';

describe('getSubscriptionEndpointRegionConfig', () => {
  it('returns null for anything but subscription auth', () => {
    expect(getSubscriptionEndpointRegionConfig('minimax', 'api_key')).toBeNull();
    expect(getSubscriptionEndpointRegionConfig('minimax', 'local')).toBeNull();
    expect(getSubscriptionEndpointRegionConfig('minimax', undefined)).toBeNull();
  });

  it('returns null for a missing or empty provider', () => {
    expect(getSubscriptionEndpointRegionConfig(undefined, 'subscription')).toBeNull();
    expect(getSubscriptionEndpointRegionConfig(null, 'subscription')).toBeNull();
    expect(getSubscriptionEndpointRegionConfig('', 'subscription')).toBeNull();
  });

  it('returns null for a provider without regional endpoints', () => {
    expect(getSubscriptionEndpointRegionConfig('anthropic', 'subscription')).toBeNull();
    expect(getSubscriptionEndpointRegionConfig('openai', 'subscription')).toBeNull();
  });

  describe('MiniMax', () => {
    const config = getSubscriptionEndpointRegionConfig('minimax', 'subscription');

    it('matches case-insensitively', () => {
      expect(getSubscriptionEndpointRegionConfig('MiniMax', 'subscription')).toBe(config);
    });

    it('validates global and cn only', () => {
      expect(config).not.toBeNull();
      expect(config!.isRegion('global')).toBe(true);
      expect(config!.isRegion('cn')).toBe(true);
      expect(config!.isRegion('sgp')).toBe(false);
      expect(config!.isRegion(null)).toBe(false);
      expect(config!.isRegion(undefined)).toBe(false);
      expect(config!.validationMessage).toContain('global, cn');
    });
  });

  describe('Xiaomi MiMo', () => {
    it.each(['xiaomi', 'mimo', 'xiaomi-mimo', 'XIAOMI'])('matches %s', (provider) => {
      const config = getSubscriptionEndpointRegionConfig(provider, 'subscription');
      expect(config).not.toBeNull();
      expect(config!.isRegion('sgp')).toBe(true);
      expect(config!.isRegion('ams')).toBe(true);
      expect(config!.isRegion('cn')).toBe(true);
      expect(config!.isRegion('global')).toBe(false);
      expect(config!.isRegion(null)).toBe(false);
      expect(config!.validationMessage).toContain('cn, sgp, ams');
    });
  });

  describe('Z.ai', () => {
    it.each(['zai', 'z.ai', 'ZAI'])('matches %s', (provider) => {
      const config = getSubscriptionEndpointRegionConfig(provider, 'subscription');
      expect(config).not.toBeNull();
      expect(config!.isRegion('global')).toBe(true);
      expect(config!.isRegion('cn')).toBe(true);
      expect(config!.isRegion('sgp')).toBe(false);
      expect(config!.validationMessage).toContain('Z.ai');
    });
  });

  it('gives each regional provider its own config', () => {
    const minimax = getSubscriptionEndpointRegionConfig('minimax', 'subscription');
    const xiaomi = getSubscriptionEndpointRegionConfig('xiaomi', 'subscription');
    const zai = getSubscriptionEndpointRegionConfig('zai', 'subscription');
    expect(new Set([minimax, xiaomi, zai]).size).toBe(3);
  });
});
