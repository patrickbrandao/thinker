// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');

describe('index.html', () => {
  it('is titled Thinker', () => {
    expect(html).toContain('<title>Thinker</title>');
    expect(html).toContain('<meta property="og:title" content="Thinker" />');
    expect(html).toContain('<meta name="twitter:title" content="Thinker" />');
  });

  it('uses the Thinker brand icons', () => {
    expect(html).toContain('href="/brand/favicon.svg?v=1"');
    expect(html).toContain('href="/brand/apple-touch-icon.png?v=1"');
  });

  it('points nowhere outside the instance (no absolute URLs, no og:image)', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/og:url|og:image|twitter:image/);
    expect(html).not.toMatch(/manifest|mnfst/i);
  });
});
