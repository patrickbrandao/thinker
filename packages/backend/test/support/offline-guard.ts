/**
 * Keeps the e2e suite off the internet (issue #114).
 *
 * `installOfflineGuard()` patches, in the test process:
 *
 *   - `net.Socket.prototype.connect`, which every TCP connection goes through
 *     (`net.connect`, `tls.connect`, `http`/`https`, Node's built-in `fetch`
 *     and the `undici` package);
 *   - `dns.lookup`, `dns.promises.lookup` and the `dns.resolve*` family.
 *
 * Allowed: loopback (127.0.0.0/8, ::1, `localhost`), Unix sockets, and the
 * disposable Postgres named by DATABASE_URL. A connection to a hostname is
 * allowed when every address it resolves to is loopback, whichever resolver
 * answers (a spec may pin a fake name to 127.0.0.1). Names under the reserved
 * `.invalid` TLD (RFC 6761) get a local NXDOMAIN without asking any resolver.
 *
 * Anything else fails the way an offline machine would (ENETUNREACH /
 * ENOTFOUND) AND is recorded, so a test whose code swallows the network error
 * still fails: the `offline-setup.ts` hooks throw on recorded violations.
 *
 * Specs that exercise ADR 0003 catalog code (openrouter.ai, models.dev,
 * raw.githubusercontent.com) or a cloud provider must mock those hosts: stub
 * `global.fetch`, or serve the provider on 127.0.0.1.
 */
// Default imports bind the real module objects (esModuleInterop wraps them as
// `.default`); `import * as` would patch a copy and leave them untouched.
import dns from 'dns';
import net from 'net';

export interface AllowedEndpoint {
  host: string;
  port: number;
}

export interface EgressViolation {
  kind: 'connect' | 'dns';
  target: string;
  stack: string;
}

export interface OfflineGuard {
  /** Returns and clears the violations recorded since the last drain. */
  drain(): EgressViolation[];
  /** Restores the original `net`/`dns` functions. */
  uninstall(): void;
}

const GUARD_KEY = Symbol.for('thinker.e2e.offlineGuard');

const RESOLVE_METHODS = [
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
] as const;

function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, '').toLowerCase();
}

/** True for `localhost`, 127.0.0.0/8, ::1 and their IPv4-mapped forms. */
export function isLoopbackHost(rawHost: string): boolean {
  const host = normalizeHost(rawHost);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const v4 = host.startsWith('::ffff:') ? host.slice('::ffff:'.length) : host;
  return net.isIPv4(v4) && v4.startsWith('127.');
}

/** The disposable Postgres from DATABASE_URL, the only non-loopback endpoint allowed. */
export function allowedEndpointsFromEnv(env: NodeJS.ProcessEnv = process.env): AllowedEndpoint[] {
  const url = env['DATABASE_URL'];
  if (!url) return [];
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return [];
    return [{ host: normalizeHost(parsed.hostname), port: Number(parsed.port || 5432) }];
  } catch {
    return [];
  }
}

export interface ConnectTarget {
  host?: string;
  port?: number;
  path?: string;
}

/**
 * Extracts the destination from the arguments `Socket.prototype.connect`
 * receives: a pre-normalized `[options, cb]` array (what `net.connect` and
 * `tls.connect` pass), an options object, `(port, host?)` or `(path)`.
 */
export function connectTarget(args: unknown[]): ConnectTarget {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first !== null && typeof first === 'object') {
    const options = first as { host?: unknown; port?: unknown; path?: unknown };
    if (typeof options.path === 'string') return { path: options.path };
    return {
      host: typeof options.host === 'string' ? options.host : undefined,
      port: options.port === undefined ? undefined : Number(options.port),
    };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first };
  return {
    port: first === undefined ? undefined : Number(first),
    host: typeof args[1] === 'string' ? args[1] : undefined,
  };
}

/** Destinations that need no vetting: loopback, Unix sockets, the test database. */
export function isAllowedConnect(target: ConnectTarget, allowed: AllowedEndpoint[]): boolean {
  if (target.path !== undefined) return true;
  // Node defaults a missing host to localhost.
  if (target.host === undefined || target.host === '') return true;
  if (isLoopbackHost(target.host)) return true;
  const host = normalizeHost(target.host);
  return allowed.some((endpoint) => endpoint.host === host && endpoint.port === target.port);
}

export type LookupDecision = 'allow' | 'nxdomain' | 'block';

/**
 * What a DNS query for `hostname` may do. IP literals never reach a resolver,
 * so looking one up is not egress (SSRF checks do it all the time); the
 * connect hook still vets the address.
 */
export function lookupDecision(hostname: unknown, allowed: AllowedEndpoint[]): LookupDecision {
  if (typeof hostname !== 'string') return 'allow';
  const host = normalizeHost(hostname);
  if (isLoopbackHost(host) || net.isIP(host) !== 0) return 'allow';
  if (allowed.some((endpoint) => endpoint.host === host)) return 'allow';
  if (host === 'invalid' || host.endsWith('.invalid')) return 'nxdomain';
  return 'block';
}

function guardError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`[e2e offline guard] ${message}`), { code });
}

function notFound(hostname: unknown, decision: LookupDecision): NodeJS.ErrnoException {
  return decision === 'nxdomain'
    ? Object.assign(new Error(`getaddrinfo ENOTFOUND ${String(hostname)}`), {
        code: 'ENOTFOUND',
        hostname,
      })
    : guardError('ENOTFOUND', `blocked DNS query for ${String(hostname)}`);
}

function callerStack(): string {
  const stack = new Error().stack ?? '';
  return stack
    .split('\n')
    .slice(1)
    .filter((line) => !line.includes('offline-guard'))
    .slice(0, 12)
    .join('\n');
}

type AnyFn = (...args: unknown[]) => unknown;
type LookupCallback = (err: Error | null, address?: unknown, family?: number) => void;

/** Splits Socket#connect arguments into an options object and the callback. */
function connectOptions(args: unknown[]): {
  options: Record<string, unknown>;
  callback?: unknown;
} {
  const first = args[0];
  if (Array.isArray(first))
    return { options: first[0] as Record<string, unknown>, callback: first[1] };
  if (first !== null && typeof first === 'object') {
    return { options: first as Record<string, unknown>, callback: args[1] };
  }
  const target = connectTarget(args);
  return {
    options: { port: target.port, host: target.host },
    callback: args.find((arg) => typeof arg === 'function'),
  };
}

function lastCallback(args: unknown[]): LookupCallback | undefined {
  for (let i = args.length - 1; i > 0; i--) {
    if (typeof args[i] === 'function') return args[i] as LookupCallback;
  }
  return undefined;
}

interface Installed {
  uninstall(): void;
}

/**
 * Installs the guard. Installing again (the next spec file in the same jest
 * worker: core modules are shared across files) replaces the previous one.
 */
export function installOfflineGuard(
  allowed: AllowedEndpoint[] = allowedEndpointsFromEnv(),
): OfflineGuard {
  const registry = net as unknown as Record<symbol, Installed | undefined>;
  registry[GUARD_KEY]?.uninstall();

  const violations: EgressViolation[] = [];
  const record = (kind: EgressViolation['kind'], target: string) => {
    violations.push({ kind, target, stack: callerStack() });
  };

  const restores: Array<() => void> = [];
  const patch = (owner: object, key: string, wrap: (original: AnyFn) => AnyFn) => {
    const target = owner as Record<string, unknown>;
    const original = target[key];
    if (typeof original !== 'function') return;
    target[key] = wrap(original as AnyFn);
    restores.push(() => {
      target[key] = original;
    });
  };

  patch(
    net.Socket.prototype,
    'connect',
    (original) =>
      function guardedConnect(this: net.Socket, ...args: unknown[]) {
        const target = connectTarget(args);
        if (isAllowedConnect(target, allowed)) return original.apply(this, args);
        const where = `${target.host}:${target.port ?? '?'}`;

        if (net.isIP(normalizeHost(target.host!)) !== 0) {
          record('connect', where);
          const err = guardError('ENETUNREACH', `blocked connection to ${where}`);
          process.nextTick(() => this.destroy(err));
          return this;
        }

        // A hostname: let it resolve through whatever lookup the caller chose
        // (the guarded dns.lookup by default), then connect only if every
        // address it got is loopback.
        const { options, callback } = connectOptions(args);
        const inner = (typeof options.lookup === 'function' ? options.lookup : dns.lookup) as AnyFn;
        const vettedLookup = (hostname: string, lookupOptions: unknown, cb: LookupCallback) => {
          inner(
            hostname,
            lookupOptions,
            (err: Error | null, address?: unknown, family?: number) => {
              if (err) return cb(err, address, family);
              const addresses = Array.isArray(address)
                ? (address as Array<{ address: string }>).map((entry) => entry.address)
                : [String(address)];
              if (addresses.length > 0 && addresses.every((a) => isLoopbackHost(a))) {
                return cb(null, address, family);
              }
              record('connect', `${where} (${addresses.join(', ')})`);
              cb(
                guardError(
                  'ENETUNREACH',
                  `blocked connection to ${where} (${addresses.join(', ')})`,
                ),
              );
            },
          );
        };
        return original.call(this, { ...options, lookup: vettedLookup }, callback);
      },
  );

  const guardCallbackDns = (method: string) =>
    patch(
      dns,
      method,
      (original) =>
        function guardedDns(this: unknown, ...args: unknown[]) {
          const hostname = args[0];
          const decision = lookupDecision(hostname, allowed);
          if (decision === 'allow') return original.apply(this, args);
          if (decision === 'block') record('dns', `${method} ${String(hostname)}`);
          const callback = lastCallback(args);
          const err = notFound(hostname, decision);
          if (callback) process.nextTick(() => callback(err));
          return undefined;
        },
    );

  const guardPromiseDns = (method: string) =>
    patch(
      dns.promises,
      method,
      (original) =>
        async function guardedPromiseDns(this: unknown, ...args: unknown[]) {
          const hostname = args[0];
          const decision = lookupDecision(hostname, allowed);
          if (decision === 'allow') return original.apply(this, args);
          if (decision === 'block') record('dns', `${method} ${String(hostname)}`);
          throw notFound(hostname, decision);
        },
    );

  for (const method of ['lookup', ...RESOLVE_METHODS]) {
    guardCallbackDns(method);
    guardPromiseDns(method);
  }

  const installed: Installed = {
    uninstall() {
      while (restores.length > 0) restores.pop()!();
      if (registry[GUARD_KEY] === installed) delete registry[GUARD_KEY];
    },
  };
  registry[GUARD_KEY] = installed;

  return {
    drain: () => violations.splice(0, violations.length),
    uninstall: () => installed.uninstall(),
  };
}

export function formatViolations(violations: EgressViolation[]): string {
  const unique = new Map<string, EgressViolation>();
  for (const v of violations) {
    const key = `${v.kind} ${v.target}`;
    if (!unique.has(key)) unique.set(key, v);
  }
  const lines = [...unique.entries()].map(([key, v]) => `  - ${key}\n${indent(v.stack)}`);
  return (
    `[e2e offline guard] ${violations.length} outbound network attempt(s) outside loopback. ` +
    `E2E tests must not reach the internet: mock the host (stub global.fetch or serve it on ` +
    `127.0.0.1).\n${lines.join('\n')}`
  );
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `      ${line.trim()}`)
    .join('\n');
}
