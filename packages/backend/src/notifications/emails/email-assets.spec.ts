import { renderToStaticMarkup } from 'react-dom/server';
import { VerifyEmailEmail } from './verify-email';
import { ResetPasswordEmail } from './reset-password';
import { TestEmail } from './test-email';
import { ThresholdAlertEmail } from './threshold-alert';

const dashboard = 'https://dashboard.example';
const renderers = {
  verification: () => VerifyEmailEmail({ userName: 'Ada', verificationUrl: `${dashboard}/verify` }),
  password: () => ResetPasswordEmail({ userName: 'Ada', resetUrl: `${dashboard}/reset` }),
  test: () => TestEmail({}),
  threshold: () =>
    ThresholdAlertEmail({
      agentName: 'demo',
      metricType: 'cost',
      threshold: 10,
      actualValue: 12,
      period: 'day',
      timestamp: '2026-09-11 12:00',
      agentUrl: `${dashboard}/harnesses/demo`,
    }),
};

describe('email image deployment URLs', () => {
  const originalUrl = process.env['BETTER_AUTH_URL'];
  beforeEach(() => {
    process.env['BETTER_AUTH_URL'] = `${dashboard}/`;
  });
  afterEach(() => {
    if (originalUrl === undefined) delete process.env['BETTER_AUTH_URL'];
    else process.env['BETTER_AUTH_URL'] = originalUrl;
  });

  it.each(Object.entries(renderers))(
    '%s renders images from the configured dashboard',
    (_, render) => {
      const html = renderToStaticMarkup(render());
      expect(html).toContain(`src="${dashboard}/thinker-logo.png"`);
      expect(html).not.toContain('app.thinker.example.com');
    },
  );

  it('honors an explicit logo hosting override', () => {
    const html = renderToStaticMarkup(TestEmail({ logoUrl: 'https://cdn.example/logo.png' }));
    expect(html).toContain('src="https://cdn.example/logo.png"');
    expect(html).not.toContain(`${dashboard}/thinker-logo.png`);
  });
});
