import {
  DEFAULT_XIAOMI_TOKEN_PLAN_REGION,
  XIAOMI_TOKEN_PLAN_BASE_URLS,
  getXiaomiTokenPlanBaseUrl,
  isXiaomiProviderId,
  isXiaomiTokenPlanRegion,
  normalizeXiaomiTokenPlanBaseUrl,
} from './xiaomi-region';

describe('xiaomi-region', () => {
  describe('isXiaomiTokenPlanRegion', () => {
    it.each(['cn', 'sgp', 'ams'])('accepts %s', (region) => {
      expect(isXiaomiTokenPlanRegion(region)).toBe(true);
    });

    it.each([undefined, null, '', 'CN', 'global', 'us'])('rejects %p', (value) => {
      expect(isXiaomiTokenPlanRegion(value)).toBe(false);
    });
  });

  describe('isXiaomiProviderId', () => {
    it.each(['xiaomi', 'mimo', 'xiaomi-mimo', 'Xiaomi', 'MIMO', 'Xiaomi-MiMo'])(
      'recognizes %s',
      (id) => {
        expect(isXiaomiProviderId(id)).toBe(true);
      },
    );

    it.each([undefined, null, '', 'zai', 'xiaomi-other', 'minimax'])('rejects %p', (id) => {
      expect(isXiaomiProviderId(id)).toBe(false);
    });
  });

  describe('getXiaomiTokenPlanBaseUrl', () => {
    it('defaults to the cn region', () => {
      expect(DEFAULT_XIAOMI_TOKEN_PLAN_REGION).toBe('cn');
      expect(getXiaomiTokenPlanBaseUrl()).toBe(XIAOMI_TOKEN_PLAN_BASE_URLS.cn);
    });

    it('returns the URL of each region over https', () => {
      expect(getXiaomiTokenPlanBaseUrl('sgp')).toBe('https://token-plan-sgp.xiaomimimo.com');
      expect(getXiaomiTokenPlanBaseUrl('ams')).toBe('https://token-plan-ams.xiaomimimo.com');
      for (const url of Object.values(XIAOMI_TOKEN_PLAN_BASE_URLS)) {
        expect(url.startsWith('https://')).toBe(true);
      }
    });
  });

  describe('normalizeXiaomiTokenPlanBaseUrl', () => {
    it('accepts the allow-listed URLs with or without trailing slash and /v1', () => {
      const cn = XIAOMI_TOKEN_PLAN_BASE_URLS.cn;
      expect(normalizeXiaomiTokenPlanBaseUrl(cn)).toBe(cn);
      expect(normalizeXiaomiTokenPlanBaseUrl(`${cn}/`)).toBe(cn);
      expect(normalizeXiaomiTokenPlanBaseUrl(`${cn}/v1`)).toBe(cn);
      expect(normalizeXiaomiTokenPlanBaseUrl(`${cn}/v1/`)).toBe(cn);
    });

    it.each([
      'https://token-plan-us.xiaomimimo.com',
      'http://token-plan-cn.xiaomimimo.com',
      'https://token-plan-cn.xiaomimimo.com.evil.example.com',
      'https://evil.example.com',
      'https://token-plan-cn.xiaomimimo.com/other',
      '',
    ])('rejects %p', (url) => {
      expect(normalizeXiaomiTokenPlanBaseUrl(url)).toBeNull();
    });
  });
});
