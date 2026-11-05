import { renderToStaticMarkup } from 'react-dom/server';
import { TriggerEventEmail, type TriggerEventEmailProps } from './trigger-event';

// Same layer as threshold-alert.spec.ts: render the React tree to static
// markup (react-email's `render` uses dynamic imports Jest's CJS transform
// can't load). Escaping is React's own guarantee, which is what matters here.
function renderEmail(overrides: Partial<TriggerEventEmailProps> = {}): string {
  return renderToStaticMarkup(
    TriggerEventEmail({
      badge: 'Provider error',
      title: 'OpenAI is failing',
      text: 'First line',
      timestamp: '2026-04-23 12:00 UTC',
      ...overrides,
    }),
  );
}

describe('TriggerEventEmail', () => {
  it('renders the badge, title and timestamp', () => {
    const html = renderEmail();
    expect(html).toContain('Provider error');
    expect(html).toContain('OpenAI is failing');
    expect(html).toContain('2026-04-23 12:00 UTC');
  });

  it('uses the title as the inbox preview text', () => {
    const html = renderEmail({ title: 'Preview me' });
    // react-email renders the preview inside a hidden div ahead of the card.
    expect(html.indexOf('Preview me')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('Preview me')).toBeLessThan(html.indexOf('Provider error'));
  });

  it('renders one paragraph per non-blank line', () => {
    const html = renderEmail({ text: 'alpha\nbeta\n\n\ngamma\n   \ndelta' });
    for (const word of ['alpha', 'beta', 'gamma', 'delta']) {
      expect(html).toContain(`>${word}</p>`);
    }
    expect(html).not.toMatch(/<p [^>]*><\/p>/);
  });

  it('renders a single paragraph for a one-line text', () => {
    const html = renderEmail({ text: 'only line' });
    expect(html.match(/>only line<\/p>/g)).toHaveLength(1);
  });

  it('renders no body paragraph for an empty or blank text', () => {
    const blank = renderEmail({ text: '   \n\n  ' });
    const withLine = renderEmail({ text: 'x' });
    expect((withLine.match(/<p /g) ?? []).length - (blank.match(/<p /g) ?? []).length).toBe(1);
  });

  it('shows the call-to-action button only when a url is given', () => {
    expect(renderEmail()).not.toContain('Open in Thinker');
    const html = renderEmail({ url: 'https://thinker.example.com/agents/a' });
    expect(html).toContain('Open in Thinker');
    expect(html).toContain('href="https://thinker.example.com/agents/a"');
  });

  it('treats an empty url as absent', () => {
    expect(renderEmail({ url: '' })).not.toContain('Open in Thinker');
  });

  it('uses a custom logo url when provided', () => {
    const html = renderEmail({ logoUrl: 'https://cdn.example.com/logo.png' });
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
  });

  it('falls back to the dashboard logo asset', () => {
    const html = renderEmail();
    expect(html).toMatch(/src="[^"]*thinker-logo\.png"/);
  });

  it('names Thinker in the footer, without any other outbound branding', () => {
    const html = renderEmail();
    expect(html).toContain('Sent by a Thinker event trigger.');
    expect(html).not.toMatch(/manifest|mnfst/i);
  });

  describe('escaping', () => {
    it('HTML-escapes hostile text, title and badge', () => {
      const html = renderEmail({
        badge: '<script>alert(1)</script>',
        title: '<img src=x onerror="alert(1)">',
        text: '<b>bold</b>\n<script>steal()</script>',
      });
      expect(html).not.toContain('<script>');
      expect(html).not.toMatch(/<img src=x/);
      expect(html).not.toContain('<b>bold</b>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    });

    it('escapes quotes so a url cannot break out of the href attribute', () => {
      const html = renderEmail({ url: 'https://x.example.com/" onclick="alert(1)' });
      expect(html).not.toContain('" onclick="alert(1)');
      expect(html).toContain('&quot; onclick=&quot;alert(1)');
    });
  });
});
