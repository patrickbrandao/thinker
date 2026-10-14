import { getDashboardBaseUrl, getEmailAssetUrl } from './dashboard-url';

describe('dashboard URLs', () => {
  const originalUrl = process.env['BETTER_AUTH_URL'];

  beforeEach(() => delete process.env['BETTER_AUTH_URL']);
  afterEach(() => {
    if (originalUrl === undefined) delete process.env['BETTER_AUTH_URL'];
    else process.env['BETTER_AUTH_URL'] = originalUrl;
  });

  it('uses the app dashboard when no deployment URL is configured', () => {
    expect(getDashboardBaseUrl()).toBe('http://localhost:2099');
    expect(getEmailAssetUrl('thinker-logo.png')).toBe('http://localhost:2099/thinker-logo.png');
  });

  it('uses the configured deployment for absolute email images', () => {
    process.env['BETTER_AUTH_URL'] = ' https://selfhosted.example/thinker/// ';
    expect(getEmailAssetUrl('/thinker-logo.png')).toBe(
      'https://selfhosted.example/thinker/thinker-logo.png',
    );
  });

  it('keeps an explicitly supplied dashboard ahead of the deployment default', () => {
    process.env['BETTER_AUTH_URL'] = 'https://selfhosted.example';
    expect(getEmailAssetUrl('thinker-logo.png', 'https://dashboard.example/')).toBe(
      'https://dashboard.example/thinker-logo.png',
    );
  });

  it('ignores a blank explicit dashboard when a deployment URL is configured', () => {
    process.env['BETTER_AUTH_URL'] = 'https://selfhosted.example/';
    expect(getDashboardBaseUrl('   ')).toBe('https://selfhosted.example');
    expect(getDashboardBaseUrl('///')).toBe('https://selfhosted.example');
  });
});
