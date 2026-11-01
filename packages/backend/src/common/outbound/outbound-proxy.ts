import { AsyncLocalStorage } from 'node:async_hooks';
import { BlockList, isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import {
  Pool,
  ProxyAgent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';
import { assertConnectableHost, pinnedDirectFetch, ssrfSafeLookup } from '../utils/ssrf-safe-fetch';
import { getContainerHostAlias } from '../utils/container-host';
import { Logger } from '@nestjs/common';

const logger = new Logger('OutboundProxy');

/**
 * Single outbound HTTP helper (Proxy Servers, tmp/PROXY-SPEC.md).
 *
 * Every outbound `fetch` of the gateway goes through {@link outboundFetch}.
 * What it does depends on the active {@link OutboundScope} (AsyncLocalStorage):
 *
 * - a scope with a chain (provider, connection, trigger or e-mail config bound
 *   to workspace proxies): each chain item is tried in order. A proxy error
 *   (refused, timeout, 407, TLS with the proxy, non-2xx CONNECT) or a 429 from
 *   the provider moves on to the next item. "Direct" is the container's own
 *   internet and ignores the global proxy. When nothing succeeds the call
 *   fails closed with {@link ProviderProxyFailedError}.
 * - no chain: the global proxy (`THINKER_HTTP_PROXY`) unless the host matches
 *   `THINKER_NO_PROXY`; a failure of the global proxy also fails closed.
 * - otherwise: a plain direct fetch, exactly as before.
 *
 * Every proxied connection goes through the `undici` package (ProxyAgent with
 * a CONNECT tunnel for every destination). The proxy host is pinned through
 * `ssrfSafeLookup`, so a proxy that resolves to a cloud metadata address is
 * refused at connect time. Through a proxy the destination is resolved by the
 * proxy itself; metadata names and literals are still refused before sending.
 */

export type ProxySourceType = 'provider' | 'connection' | 'trigger' | 'email_config' | 'test';

export type HopResult =
  | 'ok'
  | 'skipped_disabled'
  | 'refused'
  | 'timeout'
  | 'auth_407'
  | 'tls'
  | 'connect_status'
  | 'dns'
  | 'blocked'
  | 'upstream_429'
  | 'error';

export interface OutboundProxy {
  id: string;
  name: string;
  scheme: 'http' | 'https';
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  enabled: boolean;
  connectTimeoutMs: number;
  /** Debug on: every connection is logged, not only failures. */
  debug: boolean;
  /** Changes whenever the settings change, so a cached agent is never stale. */
  version: string;
}

export type EgressItem = { kind: 'proxy'; proxy: OutboundProxy } | { kind: 'direct' };

export interface EgressHop {
  kind: 'proxy' | 'direct' | 'global';
  proxy_id: string | null;
  name: string;
  /** 1-based position in the chain (1 for the global proxy and plain direct). */
  position: number;
  result: HopResult;
  ms: number;
  tunnel_ms: number | null;
  status: number | null;
  error?: string | null;
}

export interface EgressSummary {
  kind: 'proxy' | 'direct' | 'global';
  proxy_id: string | null;
  name: string | null;
}

export interface OutboundScope {
  tenantId: string | null;
  sourceType: ProxySourceType;
  sourceId: string | null;
  sourceLabel: string | null;
  /** Null or empty: no binding, the global proxy (or direct) applies. */
  chain: EgressItem[] | null;
  requestId?: string | null;
  agentMessageId?: string | null;
  /** Hops of every outbound call made in this scope, in order. */
  hops: EgressHop[];
}

export interface HopEvent {
  scope: OutboundScope;
  hop: EgressHop;
  proxy: OutboundProxy;
  /** host:port, never the path or query. */
  destination: string;
  startedAt: Date;
  bytesSent: number;
  bytesReceived: number;
}

/** No chain item could carry the call (all failed, disabled or refused). */
export class ProviderProxyFailedError extends Error {
  readonly code = 'EPROVIDERPROXYFAILED';

  constructor(
    detail: string,
    readonly hops: EgressHop[] = [],
  ) {
    super(`Outbound proxy failed: ${detail}`);
    this.name = 'ProviderProxyFailedError';
  }
}

export function isProviderProxyFailedError(error: unknown): error is ProviderProxyFailedError {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'EPROVIDERPROXYFAILED'
  );
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

const scopeStorage = new AsyncLocalStorage<OutboundScope | null>();

export function currentOutboundScope(): OutboundScope | null {
  return scopeStorage.getStore() ?? null;
}

/** Runs `fn` with `scope` as the outbound scope; `undefined` keeps the current one. */
export function runWithOutboundScope<T>(scope: OutboundScope | null | undefined, fn: () => T): T {
  if (scope === undefined) return fn();
  return scopeStorage.run(scope, fn);
}

/** Same chain and source, fresh hop list: one attempt's own hops. */
export function childScope(
  scope: OutboundScope,
  extra: Partial<OutboundScope> = {},
): OutboundScope {
  return { ...scope, ...extra, hops: [] };
}

/** Where the last call of the scope finally went out. */
export function summarizeEgress(hops: EgressHop[]): EgressSummary | null {
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (hop.result === 'skipped_disabled') continue;
    return { kind: hop.kind, proxy_id: hop.proxy_id, name: hop.kind === 'proxy' ? hop.name : null };
  }
  return null;
}

let hopSink: ((event: HopEvent) => void) | null = null;

/** Receives every use of a workspace proxy (logs and statistics). */
export function setOutboundHopSink(sink: ((event: HopEvent) => void) | null): void {
  hopSink = sink;
}

function emit(event: HopEvent): void {
  try {
    hopSink?.(event);
  } catch {
    // Logging never breaks a provider call.
  }
}

// ---------------------------------------------------------------------------
// Global proxy (environment)
// ---------------------------------------------------------------------------

export const HTTP_PROXY_ENV = 'THINKER_HTTP_PROXY';
export const NO_PROXY_ENV = 'THINKER_NO_PROXY';
const GLOBAL_CONNECT_TIMEOUT_MS = 10_000;

export interface GlobalProxyConfig {
  proxy: OutboundProxy;
  /** Display form, without credentials. */
  display: string;
  noProxy: NoProxyMatcher;
}

/**
 * Parses `THINKER_HTTP_PROXY`. Unset or blank: null. Anything that is not an
 * `http(s)://[user:pass@]host[:port]` URL throws an error naming the variable,
 * so boot fails instead of silently going out direct.
 */
export function parseProxyUrl(value: string | undefined): OutboundProxy | null {
  const raw = value?.trim() ?? '';
  if (raw === '') return null;
  const fail = (why: string): never => {
    throw new Error(
      `${HTTP_PROXY_ENV} must be an http:// or https:// proxy URL like http://user:pass@host:3128 (${why}).`,
    );
  };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('not an absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail('unsupported scheme');
  if (!url.hostname) fail('no host');
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    fail('must not carry a path, query or fragment');
  }
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  try {
    assertConnectableHost(host);
  } catch {
    fail('cloud metadata hosts are refused');
  }
  return {
    id: 'global',
    name: 'global',
    scheme,
    host,
    port: url.port ? Number(url.port) : scheme === 'https' ? 443 : 80,
    username: url.username ? decodeURIComponent(url.username) : null,
    password: url.password ? decodeURIComponent(url.password) : null,
    enabled: true,
    connectTimeoutMs: GLOBAL_CONNECT_TIMEOUT_MS,
    debug: false,
    version: 'env',
  };
}

export interface NoProxyMatcher {
  matches(hostname: string): boolean;
  entries: string[];
}

function hostOf(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

/** Hosts that never go through the global proxy: loopback and the local runners. */
export function defaultNoProxyEntries(env: NodeJS.ProcessEnv = process.env): string[] {
  const entries = ['localhost', '127.0.0.1', '::1'];
  const runners = [
    hostOf(env['OLLAMA_HOST'] || 'http://localhost:11434'),
    hostOf(env['THINKER_LMSTUDIO_BASE_URL']),
    hostOf(env['THINKER_LLAMACPP_BASE_URL']),
  ];
  // Without overrides the LM Studio / llama.cpp defaults live on the
  // container host alias.
  if (!env['THINKER_LMSTUDIO_BASE_URL'] || !env['THINKER_LLAMACPP_BASE_URL']) {
    runners.push(getContainerHostAlias());
  }
  for (const host of runners) {
    if (host && !entries.includes(host.toLowerCase())) entries.push(host.toLowerCase());
  }
  return entries;
}

/**
 * NO_PROXY list: `*`, exact hosts, domain suffixes (`example.com` and
 * `.example.com` both match subdomains), IP literals and CIDRs. A `:port`
 * suffix is ignored.
 */
export function parseNoProxy(value: string | undefined, defaults: string[] = []): NoProxyMatcher {
  const entries = [...defaults];
  for (const part of (value ?? '').split(/[\s,]+/)) {
    const entry = part.trim().toLowerCase();
    if (entry && !entries.includes(entry)) entries.push(entry);
  }
  const blockList = new BlockList();
  let any = false;
  const names: string[] = [];
  for (const entry of entries) {
    if (entry === '*') {
      any = true;
      continue;
    }
    if (entry.includes('/')) {
      const [base, bits] = entry.split('/');
      const family = isIP(base ?? '');
      const prefix = Number(bits);
      if (family === 0 || !Number.isInteger(prefix)) {
        throw new Error(`${NO_PROXY_ENV} has an invalid CIDR "${entry}".`);
      }
      blockList.addSubnet(base!, prefix, family === 6 ? 'ipv6' : 'ipv4');
      continue;
    }
    const bare = entry.replace(/^\[|\]$/g, '');
    if (isIP(bare) !== 0) {
      blockList.addAddress(bare, isIP(bare) === 6 ? 'ipv6' : 'ipv4');
      continue;
    }
    // Strip "*." / "." prefixes and any ":port".
    names.push(entry.replace(/^\*?\./, '').replace(/:\d+$/, ''));
  }
  return {
    entries,
    matches(hostname: string): boolean {
      if (any) return true;
      const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
      const family = isIP(host);
      if (family !== 0) return blockList.check(host, family === 6 ? 'ipv6' : 'ipv4');
      return names.some((name) => host === name || host.endsWith(`.${name}`));
    },
  };
}

/** Validates both variables; throws a message naming the bad one. */
export function parseGlobalProxyEnv(
  env: NodeJS.ProcessEnv = process.env,
): GlobalProxyConfig | null {
  const proxy = parseProxyUrl(env[HTTP_PROXY_ENV]);
  const noProxy = parseNoProxy(env[NO_PROXY_ENV], defaultNoProxyEntries(env));
  if (!proxy) return null;
  return { proxy, display: `${proxy.scheme}://${proxy.host}:${proxy.port}`, noProxy };
}

let globalConfig: GlobalProxyConfig | null | undefined;

export function getGlobalProxyConfig(): GlobalProxyConfig | null {
  if (globalConfig === undefined) globalConfig = parseGlobalProxyEnv(process.env);
  return globalConfig;
}

/** Test hook. */
export function setGlobalProxyConfigForTests(config: GlobalProxyConfig | null | undefined): void {
  globalConfig = config;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

const kProxyPhase = Symbol.for('thinker.outbound.proxyPhase');

interface HopProbe {
  tunnelMs: number | null;
}

const probeStorage = new AsyncLocalStorage<HopProbe>();

/**
 * Pool to the proxy itself: ProxyAgent only uses it for CONNECT. Errors raised
 * here happened before the tunnel existed, so they are tagged as proxy errors;
 * the tunnel latency is reported to the current hop probe.
 */
class TunnelPool extends Pool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override connect(...args: any[]): any {
    if (args.length > 1) return (super.connect as (...a: unknown[]) => unknown)(...args);
    const probe = probeStorage.getStore();
    const started = performance.now();
    return (super.connect(args[0]) as Promise<{ statusCode: number }>).then(
      (data) => {
        if (probe && data.statusCode === 200) {
          probe.tunnelMs = Math.round(performance.now() - started);
        }
        return data;
      },
      (err: unknown) => {
        if (err && typeof err === 'object') (err as Record<symbol, boolean>)[kProxyPhase] = true;
        throw err;
      },
    );
  }
}

const AGENT_CACHE_LIMIT = 256;
const agents = new Map<string, ProxyAgent>();

function agentKey(proxy: OutboundProxy): string {
  return [
    proxy.id,
    proxy.version,
    proxy.scheme,
    proxy.host,
    proxy.port,
    proxy.username ?? '',
    proxy.password ?? '',
    proxy.connectTimeoutMs,
  ].join('\u0000');
}

/** New ProxyAgent for `proxy`: CONNECT tunnel, pinned lookup, Basic auth. */
export function buildProxyAgent(proxy: OutboundProxy): ProxyAgent {
  assertConnectableHost(proxy.host);
  const timeout = proxy.connectTimeoutMs;
  const hostPart = isIP(proxy.host) === 6 ? `[${proxy.host}]` : proxy.host;
  return new ProxyAgent({
    uri: `${proxy.scheme}://${hostPart}:${proxy.port}`,
    ...(proxy.username
      ? {
          token: `Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64')}`,
        }
      : {}),
    proxyTunnel: true,
    connectTimeout: timeout,
    proxyTls: { lookup: ssrfSafeLookup } as never,
    clientFactory: (origin, opts) =>
      new TunnelPool(origin, { ...opts, headersTimeout: timeout, bodyTimeout: timeout }),
  });
}

/** Cached ProxyAgent per proxy settings (keep-alive tunnels are reused). */
export function getProxyAgent(proxy: OutboundProxy): ProxyAgent {
  const key = agentKey(proxy);
  const cached = agents.get(key);
  if (cached) {
    // Refresh LRU position.
    agents.delete(key);
    agents.set(key, cached);
    return cached;
  }
  const agent = buildProxyAgent(proxy);
  for (const [oldKey, oldAgent] of agents) {
    if (oldKey.startsWith(`${proxy.id}\u0000`)) {
      agents.delete(oldKey);
      void oldAgent.close().catch(() => undefined);
    }
  }
  if (agents.size >= AGENT_CACHE_LIMIT) {
    const [oldestKey, oldest] = agents.entries().next().value as [string, ProxyAgent];
    agents.delete(oldestKey);
    void oldest.close().catch(() => undefined);
  }
  agents.set(key, agent);
  return agent;
}

export function proxyAgentCacheSize(): number {
  return agents.size;
}

/** Closes every cached agent (tests and shutdown). */
export async function clearProxyAgentCache(): Promise<void> {
  const all = [...agents.values()];
  agents.clear();
  await Promise.all(all.map((agent) => agent.close().catch(() => undefined)));
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function errorChain(error: unknown): Array<Record<string | symbol, unknown>> {
  const out: Array<Record<string | symbol, unknown>> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
    out.push(current as Record<string | symbol, unknown>);
    current = (current as { cause?: unknown }).cause;
  }
  return out;
}

function classifyCode(code: string, message: string): HopResult {
  if (code === 'ESSRFBLOCKED') return 'blocked';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    /timeout/i.test(message)
  ) {
    return 'timeout';
  }
  if (
    code.startsWith('ERR_TLS') ||
    code.startsWith('ERR_SSL') ||
    code === 'UND_ERR_PRX_TLS' ||
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(code) ||
    /ssl|tls/i.test(message)
  ) {
    return 'tls';
  }
  if (
    ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(code) ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_CLOSED' ||
    code === 'UND_ERR_PRX_CONN'
  ) {
    return 'refused';
  }
  return 'error';
}

export interface ProxyErrorClass {
  result: HopResult;
  status: number | null;
  message: string;
}

/**
 * Classifies an error from a proxied fetch. Returns null when the error did
 * not come from the proxy (the tunnel was up): that is a destination error and
 * follows the normal flow.
 */
export function classifyProxyError(error: unknown): ProxyErrorClass | null {
  const chain = errorChain(error);
  for (const entry of chain) {
    const message = typeof entry.message === 'string' ? entry.message : '';
    const tunnel = /Proxy response \((\d+)\) !== 200/.exec(message);
    if (tunnel) {
      const status = Number(tunnel[1]);
      return {
        result: status === 407 ? 'auth_407' : 'connect_status',
        status,
        message:
          status === 407
            ? 'Proxy authentication required (407)'
            : `Proxy answered CONNECT with ${status}`,
      };
    }
  }
  for (const entry of chain) {
    const code = typeof entry.code === 'string' ? entry.code : '';
    const message = typeof entry.message === 'string' ? entry.message : '';
    if (entry[kProxyPhase] === true || code === 'UND_ERR_PRX_TLS' || code === 'UND_ERR_PRX_CONN') {
      // The tagged error may wrap the root cause (ProxyConnectionError).
      const root = chain[chain.length - 1]!;
      const rootCode = typeof root.code === 'string' ? root.code : code;
      const rootMessage = typeof root.message === 'string' ? root.message : message;
      const result = classifyCode(rootCode || code, rootMessage || message);
      return { result, status: null, message: (rootMessage || message || result).slice(0, 300) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface OutboundFetchOptions {
  /** User-supplied destination: pin direct connections to validated addresses. */
  pinDestination?: boolean;
}

type FetchInit = RequestInit;

function bodySize(body: unknown): number {
  if (body === undefined || body === null) return 0;
  if (typeof body === 'string') return Buffer.byteLength(body);
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return 0;
}

function destinationOf(url: URL): string {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return `${url.hostname}:${port}`;
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** Counts response bytes as the caller reads them; `done` fires once. */
function countBody(response: Response, done: (bytes: number) => void): Response {
  if (!response.body || NULL_BODY_STATUSES.has(response.status)) {
    done(0);
    return response;
  }
  let bytes = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done(bytes);
  };
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      finish();
    },
    // A cancelled read still reports what was received.
    cancel() {
      finish();
    },
  } as Transformer<Uint8Array, Uint8Array>);
  const body = (response.body as ReadableStream<Uint8Array>).pipeThrough(counter);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers as unknown as HeadersInit,
  });
}

function directFetch(url: string, init: FetchInit, pin: boolean): Promise<Response> {
  return pin ? pinnedDirectFetch(url, init) : fetch(url, init);
}

/** One fetch through `proxy`. Throws the raw undici error on failure. */
export async function fetchViaProxy(
  proxy: OutboundProxy,
  url: string,
  init: FetchInit,
  agent?: ProxyAgent,
): Promise<{ response: Response; tunnelMs: number | null }> {
  assertConnectableHost(new URL(url).hostname);
  const probe: HopProbe = { tunnelMs: null };
  const dispatcher = agent ?? getProxyAgent(proxy);
  const response = await probeStorage.run(probe, () =>
    undiciFetch(url, { ...(init as unknown as UndiciRequestInit), dispatcher }),
  );
  return { response: response as unknown as Response, tunnelMs: probe.tunnelMs };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
  }
  return String(error);
}

async function runChain(
  scope: OutboundScope,
  chain: EgressItem[],
  url: string,
  init: FetchInit,
  pin: boolean,
): Promise<Response> {
  const target = new URL(url);
  const destination = destinationOf(target);
  const bytesSent = bodySize(init.body);
  const failures: string[] = [];
  const startHops = scope.hops.length;
  let held429: Response | null = null;

  for (let index = 0; index < chain.length; index++) {
    const item = chain[index]!;
    const position = index + 1;
    const isLast = index === chain.length - 1;

    if (item.kind === 'proxy' && !item.proxy.enabled) {
      scope.hops.push({
        kind: 'proxy',
        proxy_id: item.proxy.id,
        name: item.proxy.name,
        position,
        result: 'skipped_disabled',
        ms: 0,
        tunnel_ms: null,
        status: null,
      });
      failures.push(`${item.proxy.name}: disabled`);
      continue;
    }

    const startedAt = new Date();
    const started = performance.now();
    let response: Response;
    let tunnelMs: number | null = null;
    try {
      if (item.kind === 'direct') {
        response = await directFetch(url, init, pin);
      } else {
        ({ response, tunnelMs } = await fetchViaProxy(item.proxy, url, init));
      }
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      const aborted = init.signal?.aborted === true;
      const cls = item.kind === 'proxy' && !aborted ? classifyProxyError(error) : null;
      if (!cls || item.kind !== 'proxy') {
        // Direct errors, aborts and destination errors through a working
        // tunnel follow the normal transport-error flow.
        const hop: EgressHop = {
          kind: item.kind,
          proxy_id: item.kind === 'proxy' ? item.proxy.id : null,
          name: item.kind === 'proxy' ? item.proxy.name : 'direct',
          position,
          result: 'error',
          ms,
          tunnel_ms: tunnelMs,
          status: null,
          error: errorMessage(error).slice(0, 300),
        };
        scope.hops.push(hop);
        if (item.kind === 'proxy') {
          emit({
            scope,
            hop,
            proxy: item.proxy,
            destination,
            startedAt,
            bytesSent,
            bytesReceived: 0,
          });
        }
        if (held429) void held429.body?.cancel().catch(() => undefined);
        throw error;
      }
      const hop: EgressHop = {
        kind: 'proxy',
        proxy_id: item.proxy.id,
        name: item.proxy.name,
        position,
        result: cls.result,
        ms,
        tunnel_ms: null,
        status: cls.status,
        error: cls.message,
      };
      scope.hops.push(hop);
      emit({
        scope,
        hop,
        proxy: item.proxy,
        destination,
        startedAt,
        bytesSent: 0,
        bytesReceived: 0,
      });
      failures.push(`${item.proxy.name}: ${cls.result}`);
      continue;
    }

    const ms = Math.round(performance.now() - started);
    const hop: EgressHop = {
      kind: item.kind,
      proxy_id: item.kind === 'proxy' ? item.proxy.id : null,
      name: item.kind === 'proxy' ? item.proxy.name : 'direct',
      position,
      result: 'ok',
      ms,
      tunnel_ms: tunnelMs,
      status: response.status,
    };
    scope.hops.push(hop);

    if (response.status === 429 && !isLast) {
      hop.result = 'upstream_429';
      if (item.kind === 'proxy') {
        emit({
          scope,
          hop,
          proxy: item.proxy,
          destination,
          startedAt,
          bytesSent,
          bytesReceived: 0,
        });
      }
      if (held429) void held429.body?.cancel().catch(() => undefined);
      held429 = response;
      failures.push(`${hop.name}: upstream_429`);
      continue;
    }

    if (held429) void held429.body?.cancel().catch(() => undefined);
    if (item.kind === 'direct') return response;
    const proxy = item.proxy;
    return countBody(response, (bytesReceived) =>
      emit({ scope, hop, proxy, destination, startedAt, bytesSent, bytesReceived }),
    );
  }

  // Everything after a 429 failed: hand back that 429 so key rotation runs.
  if (held429) return held429;
  throw new ProviderProxyFailedError(
    failures.length > 0 ? failures.join('; ') : 'empty chain',
    scope.hops.slice(startHops),
  );
}

async function viaGlobal(
  config: GlobalProxyConfig,
  scope: OutboundScope | null,
  url: string,
  init: FetchInit,
): Promise<Response> {
  const started = performance.now();
  try {
    const { response, tunnelMs } = await fetchViaProxy(config.proxy, url, init);
    scope?.hops.push({
      kind: 'global',
      proxy_id: null,
      name: 'global',
      position: 1,
      result: 'ok',
      ms: Math.round(performance.now() - started),
      tunnel_ms: tunnelMs,
      status: response.status,
    });
    return response;
  } catch (error) {
    const cls = init.signal?.aborted ? null : classifyProxyError(error);
    if (!cls) throw error;
    const hop: EgressHop = {
      kind: 'global',
      proxy_id: null,
      name: 'global',
      position: 1,
      result: cls.result,
      ms: Math.round(performance.now() - started),
      tunnel_ms: null,
      status: cls.status,
      error: cls.message,
    };
    scope?.hops.push(hop);
    logger.warn(
      `Global proxy ${config.display} failed for ${destinationOf(new URL(url))}: ${cls.result} (${cls.message})`,
    );
    throw new ProviderProxyFailedError(`global: ${cls.result}`, [hop]);
  }
}

/**
 * Outbound `fetch`. See the module comment for the routing rules. Without a
 * scope chain and without a global proxy it is exactly the previous behavior
 * (`fetch`, or the pinned SSRF-safe fetch when `pinDestination`).
 */
export async function outboundFetch(
  url: string | URL,
  init: FetchInit = {},
  opts: OutboundFetchOptions = {},
): Promise<Response> {
  const href = typeof url === 'string' ? url : url.href;
  const pin = opts.pinDestination === true;
  const scope = currentOutboundScope();
  const chain = scope?.chain;
  if (scope && chain && chain.length > 0) {
    return runChain(scope, chain, href, init, pin);
  }
  const global = getGlobalProxyConfig();
  const hostname = new URL(href).hostname;
  if (global && !global.noProxy.matches(hostname)) {
    return viaGlobal(global, scope, href, init);
  }
  const started = performance.now();
  const response = await directFetch(href, init, pin);
  scope?.hops.push({
    kind: 'direct',
    proxy_id: null,
    name: 'direct',
    position: 1,
    result: 'ok',
    ms: Math.round(performance.now() - started),
    tunnel_ms: null,
    status: response.status,
  });
  return response;
}
