import {
  extractThinkerErrorCode,
  formatThinkerError,
  THINKER_ERRORS,
  THINKER_ERRORS_DOCS_BASE,
  ThinkerErrorCode,
} from '../error-codes';

describe('THINKER_ERRORS registry', () => {
  it('exposes the public docs base URL', () => {
    expect(THINKER_ERRORS_DOCS_BASE).toBe(
      'https://github.com/patrickbrandao/thinker/blob/main/docs/erros.md',
    );
  });

  it('every code has a non-empty title and template', () => {
    for (const [code, entry] of Object.entries(THINKER_ERRORS)) {
      expect(entry.title).toBeTruthy();
      expect(entry.template).toBeTruthy();
      expect(code).toMatch(/^M\d{3}$/);
    }
  });

  it('every code is unique', () => {
    const codes = Object.keys(THINKER_ERRORS);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('formatThinkerError', () => {
  it('wraps a static template with the peacock prefix and docs URL', () => {
    const out = formatThinkerError('M001');
    expect(out).toContain('[🦚 Thinker M001]');
    expect(out).toContain('Missing the Authorization header');
    expect(out).toContain('https://github.com/patrickbrandao/thinker/blob/main/docs/erros.md#m001');
  });

  it('interpolates {var} placeholders from the vars object', () => {
    const out = formatThinkerError('M100', {
      provider: 'anthropic',
      dashboardUrl: 'https://dash.example/x',
    });
    expect(out).toContain('No anthropic API key yet');
    expect(out).toContain('https://dash.example/x');
    expect(out).not.toContain('{provider}');
    expect(out).not.toContain('{dashboardUrl}');
  });

  it('leaves placeholders untouched when a var is missing', () => {
    const out = formatThinkerError('M100', { provider: 'openai' });
    expect(out).toContain('No openai API key yet');
    expect(out).toContain('{dashboardUrl}');
  });

  it('renders M101 as a missing default model, not missing providers (#2942)', () => {
    const out = formatThinkerError('M101', { dashboardUrl: 'https://dash.example/routing' });
    expect(out).toContain('[🦚 Thinker M101]');
    expect(out).toContain('This harness has no model to route to yet. Pick a default model here');
    expect(out).toContain('https://dash.example/routing');
  });

  it('inserts the optional M101 detail before the dashboard link', () => {
    const out = formatThinkerError('M101', {
      dashboardUrl: 'https://dash.example/routing',
      detail: ' The default tier has no model set.',
    });
    expect(out).toContain(
      'no model to route to yet. The default tier has no model set. Pick a default model here',
    );
  });

  it('renders M102 for unusable subscription credentials', () => {
    const out = formatThinkerError('M102', {
      provider: 'openai',
      dashboardUrl: 'https://dash.example/routing',
    });
    expect(out).toContain('[🦚 Thinker M102]');
    expect(out).toContain('openai subscription credentials could not be refreshed');
    expect(out).toContain('https://dash.example/routing');
  });

  it('appends the docs URL exactly once', () => {
    const out = formatThinkerError('M500');
    const matches = out.match(/docs\/erros\.md#m500/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('produces a stable output for every registered code', () => {
    for (const code of Object.keys(THINKER_ERRORS) as ThinkerErrorCode[]) {
      const out = formatThinkerError(code);
      expect(out.startsWith(`[🦚 Thinker ${code}]`)).toBe(true);
      expect(out.endsWith(`See ${THINKER_ERRORS_DOCS_BASE}#${code.toLowerCase()}`)).toBe(true);
    }
  });
});

describe('extractThinkerErrorCode', () => {
  it('returns null for empty or non-Thinker text', () => {
    expect(extractThinkerErrorCode(null)).toBeNull();
    expect(extractThinkerErrorCode(undefined)).toBeNull();
    expect(extractThinkerErrorCode('')).toBeNull();
    expect(extractThinkerErrorCode('upstream 500')).toBeNull();
    expect(extractThinkerErrorCode('[Thinker M999] unknown')).toBeNull();
    // A provider body that echoes the code text without the peacock must NOT
    // be mistaken for a Thinker error (guards against provider-error mislabeling).
    expect(extractThinkerErrorCode('[Thinker M100] echoed by an upstream')).toBeNull();
    expect(extractThinkerErrorCode('provider said: Thinker M102 somewhere')).toBeNull();
  });

  it('extracts the code from a formatted peacock message', () => {
    expect(extractThinkerErrorCode(formatThinkerError('M102', { provider: 'openai' }))).toBe(
      'M102',
    );
    expect(
      extractThinkerErrorCode('[🦚 Thinker M100] No openai API key yet. Add one here: https://x'),
    ).toBe('M100');
  });

  it('finds the code when nested inside a JSON error body', () => {
    const body = JSON.stringify({
      error: {
        message: formatThinkerError('M102', {
          provider: 'openai',
          dashboardUrl: 'https://dash/routing',
        }),
      },
    });
    expect(extractThinkerErrorCode(body)).toBe('M102');
  });

  it('round-trips every registered code', () => {
    for (const code of Object.keys(THINKER_ERRORS) as ThinkerErrorCode[]) {
      expect(extractThinkerErrorCode(formatThinkerError(code))).toBe(code);
    }
  });
});
