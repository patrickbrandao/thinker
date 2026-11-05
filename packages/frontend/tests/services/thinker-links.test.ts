import { describe, it, expect } from 'vitest';
import {
  THINKER_DOCS_URL,
  THINKER_ISSUES_URL,
  THINKER_LOGO_DARK_URL,
  THINKER_LOGO_URL,
  THINKER_MARK_512_URL,
  THINKER_MARK_URL,
  THINKER_PROVIDERS_DOCS_URL,
  THINKER_REPO_URL,
} from '../../src/services/thinker-links';

describe('thinker-links', () => {
  it('derives the docs, provider docs and issue URLs from the repository URL', () => {
    expect(THINKER_REPO_URL).toBe('https://github.com/patrickbrandao/thinker');
    expect(THINKER_DOCS_URL).toBe(THINKER_REPO_URL + '/tree/main/docs');
    expect(THINKER_PROVIDERS_DOCS_URL).toBe(THINKER_DOCS_URL + '/providers');
    expect(THINKER_ISSUES_URL).toBe(THINKER_REPO_URL + '/issues');
  });

  it('only links over HTTPS, with no trailing slash', () => {
    for (const url of [
      THINKER_REPO_URL,
      THINKER_DOCS_URL,
      THINKER_PROVIDERS_DOCS_URL,
      THINKER_ISSUES_URL,
    ]) {
      expect(url.startsWith('https://')).toBe(true);
      expect(url.endsWith('/')).toBe(false);
    }
  });

  it('serves brand assets from /brand/ with a shared cache-busting version', () => {
    const assets = [
      THINKER_LOGO_URL,
      THINKER_LOGO_DARK_URL,
      THINKER_MARK_URL,
      THINKER_MARK_512_URL,
    ];
    for (const url of assets) expect(url).toMatch(/^\/brand\/[\w-]+\.png\?v=\d+$/);
    expect(new Set(assets.map((u) => u.split('?v=')[1])).size).toBe(1);
    expect(new Set(assets).size).toBe(4);
  });

  it('never points a brand asset at an external host (strict CSP, no CDN)', () => {
    for (const url of [
      THINKER_LOGO_URL,
      THINKER_LOGO_DARK_URL,
      THINKER_MARK_URL,
      THINKER_MARK_512_URL,
    ]) {
      expect(url.startsWith('/')).toBe(true);
      expect(url).not.toContain('//');
    }
  });
});
