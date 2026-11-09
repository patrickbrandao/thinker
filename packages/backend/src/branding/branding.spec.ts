import { logoOrigin, readBranding } from './branding';

describe('readBranding', () => {
  it('defaults to Thinker, no logo override, info shown', () => {
    expect(readBranding({})).toEqual({ title: 'Thinker', logoUrl: null, hideInfo: false });
  });

  it('reads THINKER_TITLE, THINKER_LOGO_URL and THINKER_HIDE_INFO', () => {
    expect(
      readBranding({
        THINKER_TITLE: ' Acme AI ',
        THINKER_LOGO_URL: 'https://cdn.acme.test/logo.png',
        THINKER_HIDE_INFO: 'TRUE',
      }),
    ).toEqual({ title: 'Acme AI', logoUrl: 'https://cdn.acme.test/logo.png', hideInfo: true });
  });

  it('only hides info for "true"', () => {
    expect(readBranding({ THINKER_HIDE_INFO: '1' }).hideInfo).toBe(false);
  });
});

describe('logoOrigin', () => {
  it('returns the origin of absolute http(s) URLs only', () => {
    expect(logoOrigin('https://cdn.acme.test/a/logo.png')).toBe('https://cdn.acme.test');
    expect(logoOrigin('/custom/logo.png')).toBeNull();
    expect(logoOrigin('javascript:alert(1)')).toBeNull();
    expect(logoOrigin(null)).toBeNull();
  });
});
