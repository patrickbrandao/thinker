import {
  CORS_PREFLIGHT_MAX_AGE_SECONDS,
  applyPrivateNetworkAllow,
  buildCorsOptions,
  buildDevAllowedOrigins,
  buildProdAllowedOrigins,
  createCorsOriginHandler,
  parseExtraOrigins,
  parseFrameAncestors,
} from './cors-csp-config';

const TOOL_ORIGIN = 'https://tools.acme.dev';

describe('parseExtraOrigins', () => {
  it('returns nothing when unset or blank', () => {
    expect(parseExtraOrigins(undefined)).toEqual([]);
    expect(parseExtraOrigins('')).toEqual([]);
    expect(parseExtraOrigins('  , ,')).toEqual([]);
  });

  it('trims entries and strips a trailing slash', () => {
    expect(parseExtraOrigins(' https://a.example.com/ , https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});

describe('buildDevAllowedOrigins', () => {
  it('allows only the configured Vite frontend by default', () => {
    expect(buildDevAllowedOrigins({ configuredOrigin: 'http://localhost:3000' })).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('adds THINKER_CORS_ORIGINS extras, deduped', () => {
    expect(
      buildDevAllowedOrigins({
        configuredOrigin: 'http://localhost:3000',
        extraOrigins: `${TOOL_ORIGIN}, http://localhost:3000/`,
      }),
    ).toEqual(['http://localhost:3000', TOOL_ORIGIN]);
  });
});

describe('buildProdAllowedOrigins', () => {
  it('allows no cross-origin caller by default', () => {
    expect(buildProdAllowedOrigins()).toEqual([]);
    expect(buildProdAllowedOrigins({ extraOrigins: '' })).toEqual([]);
  });

  it('allows only operator-configured origins, trimmed and deduped', () => {
    expect(
      buildProdAllowedOrigins({
        extraOrigins: ` ${TOOL_ORIGIN} , https://other.acme.dev ,${TOOL_ORIGIN}/`,
      }),
    ).toEqual([TOOL_ORIGIN, 'https://other.acme.dev']);
  });

  it('ignores empty / whitespace-only extra origins', () => {
    expect(buildProdAllowedOrigins({ extraOrigins: '  , ,' })).toEqual([]);
  });
});

describe('parseFrameAncestors', () => {
  it("defaults to 'none' when unset", () => {
    expect(parseFrameAncestors(undefined)).toEqual(["'none'"]);
  });

  it("defaults to 'none' for an empty string", () => {
    expect(parseFrameAncestors('')).toEqual(["'none'"]);
  });

  it('keeps a single well-formed https origin', () => {
    expect(parseFrameAncestors('https://app.example.com')).toEqual(['https://app.example.com']);
  });

  it('keeps multiple valid origins in order and trims whitespace', () => {
    expect(parseFrameAncestors('https://a.example.com , http://localhost:3000')).toEqual([
      'https://a.example.com',
      'http://localhost:3000',
    ]);
  });

  it("keeps the 'self' and 'none' CSP keywords", () => {
    expect(parseFrameAncestors("'self', 'none'")).toEqual(["'self'", "'none'"]);
  });

  it('keeps a wildcard-subdomain origin', () => {
    expect(parseFrameAncestors('https://*.example.com')).toEqual(['https://*.example.com']);
  });

  it('keeps an origin with an explicit port', () => {
    expect(parseFrameAncestors('https://example.com:8443')).toEqual(['https://example.com:8443']);
  });

  it('drops the bare wildcard (would allow any site to frame the app)', () => {
    expect(parseFrameAncestors('*')).toEqual(["'none'"]);
  });

  it('drops malformed entries (scheme-only, raw CIDR) but keeps valid ones', () => {
    expect(parseFrameAncestors('https:, 192.168.1.0/24, https://good.example.com')).toEqual([
      'https://good.example.com',
    ]);
  });

  it("falls back to 'none' when every entry is malformed", () => {
    expect(parseFrameAncestors('https:, not a url, javascript:alert(1)')).toEqual(["'none'"]);
  });
});

describe('createCorsOriginHandler', () => {
  const handler = createCorsOriginHandler([TOOL_ORIGIN, 'http://localhost:3000']);

  it('allows requests with no Origin header (same-origin / curl / server-to-server)', () => {
    const cb = jest.fn();
    handler(undefined, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('allows a listed origin', () => {
    const cb = jest.fn();
    handler(TOOL_ORIGIN, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('blocks an unlisted origin without surfacing an error', () => {
    const cb = jest.fn();
    handler('https://evil.example.com', cb);
    expect(cb).toHaveBeenCalledWith(null, false);
  });
});

describe('buildCorsOptions', () => {
  it('caches the preflight via maxAge so reloads stop re-running it', () => {
    const opts = buildCorsOptions([TOOL_ORIGIN]);
    expect(opts.maxAge).toBe(CORS_PREFLIGHT_MAX_AGE_SECONDS);
    expect(CORS_PREFLIGHT_MAX_AGE_SECONDS).toBe(7200);
  });

  it('keeps credentials off the cross-origin path (bearer keys, never cookies)', () => {
    expect(buildCorsOptions([TOOL_ORIGIN]).credentials).toBe(false);
  });

  it('wires the allow-list origin handler (allows listed, blocks unlisted)', () => {
    const { origin } = buildCorsOptions([TOOL_ORIGIN]);
    const allow = jest.fn();
    origin(TOOL_ORIGIN, allow);
    expect(allow).toHaveBeenCalledWith(null, true);
    const block = jest.fn();
    origin('https://evil.example.com', block);
    expect(block).toHaveBeenCalledWith(null, false);
  });
});

describe('applyPrivateNetworkAllow', () => {
  const allowed = [TOOL_ORIGIN, 'http://localhost:3000'];

  it('echoes the PNA allow header for OPTIONS preflight from a listed origin', () => {
    const setHeader = jest.fn();
    applyPrivateNetworkAllow(
      {
        method: 'OPTIONS',
        headers: {
          origin: TOOL_ORIGIN,
          'access-control-request-private-network': 'true',
        },
      },
      allowed,
      setHeader,
    );
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Private-Network', 'true');
  });

  it('does not echo for non-OPTIONS methods', () => {
    const setHeader = jest.fn();
    applyPrivateNetworkAllow(
      {
        method: 'GET',
        headers: {
          origin: TOOL_ORIGIN,
          'access-control-request-private-network': 'true',
        },
      },
      allowed,
      setHeader,
    );
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('does not echo when the PNA request header is missing', () => {
    const setHeader = jest.fn();
    applyPrivateNetworkAllow(
      { method: 'OPTIONS', headers: { origin: TOOL_ORIGIN } },
      allowed,
      setHeader,
    );
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('does not echo for unlisted origins (no free pass for arbitrary callers)', () => {
    const setHeader = jest.fn();
    applyPrivateNetworkAllow(
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example.com',
          'access-control-request-private-network': 'true',
        },
      },
      allowed,
      setHeader,
    );
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('does not echo when the Origin header is missing entirely', () => {
    const setHeader = jest.fn();
    applyPrivateNetworkAllow(
      {
        method: 'OPTIONS',
        headers: { 'access-control-request-private-network': 'true' },
      },
      allowed,
      setHeader,
    );
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('ignores duplicate-header arrays (Express normalises but Node http does not)', () => {
    const setHeader = jest.fn();
    applyPrivateNetworkAllow(
      {
        method: 'OPTIONS',
        headers: {
          origin: [TOOL_ORIGIN, TOOL_ORIGIN],
          'access-control-request-private-network': 'true',
        },
      },
      allowed,
      setHeader,
    );
    expect(setHeader).not.toHaveBeenCalled();
  });
});
