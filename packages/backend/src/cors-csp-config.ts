// Single source of truth for the CORS allow-lists. The dashboard is
// same-origin, so by default no cross-origin browser caller is allowed in
// production. An operator who runs a browser tool on another origin that must
// call the gateway opts it in with `THINKER_CORS_ORIGINS`. No third-party origin
// is ever allowed by default (#17).

export interface DevOriginBuilderOptions {
  /** The Vite dev server origin (`CORS_ORIGIN`, defaults to http://localhost:3000). */
  configuredOrigin: string;
  /** Comma-separated extra origins from `THINKER_CORS_ORIGINS`. */
  extraOrigins?: string;
}

export interface ProdOriginBuilderOptions {
  /**
   * Comma-separated extra origins from `THINKER_CORS_ORIGINS`: browser origins,
   * other than the gateway's own, that the operator authorizes to call it.
   */
  extraOrigins?: string;
}

/**
 * Splits a comma-separated origin list, trimming whitespace and any trailing
 * slash: browser `Origin` headers never carry one, so an exact-match entry like
 * `https://tools.acme.dev/` would never match otherwise.
 */
export function parseExtraOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter((v) => v.length > 0);
}

export function buildDevAllowedOrigins({
  configuredOrigin,
  extraOrigins,
}: DevOriginBuilderOptions): string[] {
  return Array.from(new Set([configuredOrigin, ...parseExtraOrigins(extraOrigins)]));
}

// Production CORS allow-list: only the origins the operator configured. Exact
// match only, and `credentials: false` at the call site keeps this safe: an
// allow-listed origin still needs the user's own bearer key and no session
// cookie can ride along.
export function buildProdAllowedOrigins({ extraOrigins }: ProdOriginBuilderOptions = {}): string[] {
  return Array.from(new Set(parseExtraOrigins(extraOrigins)));
}

// Matches a well-formed CSP host-source: an http(s) origin with an optional
// `*.` subdomain wildcard, a host, and an optional port — no path, query, or
// fragment. Anything else (scheme-only `https:`, a raw CIDR like
// `192.168.1.0/24`, a bare `*`, junk) is rejected so a typo in FRAME_ANCESTORS
// can't weaken clickjacking protection or emit a malformed CSP token.
const FRAME_ANCESTOR_ORIGIN_RE = /^https?:\/\/(\*\.)?[a-zA-Z0-9.-]+(:\d+)?$/;

/**
 * Parse the operator-supplied `FRAME_ANCESTORS` env value into a validated CSP
 * `frame-ancestors` directive. Each comma-separated entry is kept only when it
 * is the `'self'` / `'none'` keyword or a well-formed http(s) origin; malformed
 * entries (and the wildcard `*`, which would allow any site to frame the app)
 * are dropped. Falls back to `'none'` when unset or when nothing valid remains,
 * so a fully-malformed value never silently disables framing protection.
 */
export function parseFrameAncestors(raw: string | undefined): string[] {
  if (!raw) return ["'none'"];
  const valid = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v === "'self'" || v === "'none'" || FRAME_ANCESTOR_ORIGIN_RE.test(v));
  return valid.length > 0 ? valid : ["'none'"];
}

export type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;
export type CorsOriginHandler = (origin: string | undefined, callback: CorsOriginCallback) => void;

export function createCorsOriginHandler(allowedOrigins: string[]): CorsOriginHandler {
  return (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}

// Preflight cache lifetime (seconds), shared by the dev and production CORS
// paths. Without a max-age the browser re-runs the preflight — including the
// legacy Private Network Access preflight — roughly every 5s, so every dashboard
// reload (dev) or burst of cross-origin requests (production) re-issues one.
// Each round trip is another chance for a transient blip to surface as a
// spurious CORS error. Caching the preflight collapses those repeats. 7200s
// (2h) is the ceiling Chrome honors.
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 7200;

export interface CorsOptions {
  origin: CorsOriginHandler;
  credentials: false;
  maxAge: number;
}

// The exact `enableCors()` options main.ts uses (both dev and production —
// only the allow-list differs), kept here so the e2e/unit tests exercise the
// real shape rather than a hand-rolled copy. `credentials: false` is
// deliberate — gateway callers use bearer keys, never cookies, so keeping
// credentials off the cross-origin path means a misconfigured allow-list can't
// leak session cookies. `allowedHeaders` is intentionally omitted so the cors
// middleware reflects the request's `Access-Control-Request-Headers` (browser
// SDKs send fingerprints like the `X-Stainless-*` family; a fixed allow-list
// would fail those preflights).
export function buildCorsOptions(allowedOrigins: string[]): CorsOptions {
  return {
    origin: createCorsOriginHandler(allowedOrigins),
    credentials: false,
    maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
  };
}

// LEGACY — kept for old browsers only. Do not reach for this when debugging a
// blocked loopback request; it will not help, and believing it does has cost
// us the same bug more than once.
//
// Chrome's Private Network Access let a server opt in to public-HTTPS →
// loopback requests by echoing `Access-Control-Allow-Private-Network: true` on
// the preflight. Chrome ≥ 138 replaced PNA with **Local Network Access**, which
// is a *user permission* — no response header can grant it, and in a
// cross-origin iframe it's denied by permissions policy unless the embedder
// sends `allow="local-network-access"`, so the prompt never even appears.
//
// The browser still reports the block as a CORS error, which is exactly why it
// keeps being mistaken for one. Verified on Chrome 148: the request fails with
// this header present and succeeds with
// `--disable-features=LocalNetworkAccessChecks`.
//
// The fix is not to send another header — it's to not cross the address-space
// boundary. This header stays because pre-138 Chrome still honours it and it
// costs nothing.
//
// Shape kept narrow on purpose: takes only the request fields read and
// a setHeader callback so it composes with Express middleware and unit
// tests without dragging in `Request` / `Response` types.
export interface PnaRequest {
  method: string;
  headers: {
    origin?: string | string[];
    'access-control-request-private-network'?: string | string[];
  };
}

export function applyPrivateNetworkAllow(
  req: PnaRequest,
  allowedOrigins: string[],
  setHeader: (name: string, value: string) => void,
): void {
  if (req.method !== 'OPTIONS') return;
  const pnaHeader = req.headers['access-control-request-private-network'];
  if (pnaHeader !== 'true') return;
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) return;
  setHeader('Access-Control-Allow-Private-Network', 'true');
}
