import { fetchJson, fetchMutate, type FetchMutateOptions } from './core.js';

/** Workspace outbound HTTP proxy servers, their chains (bindings), logs and stats. */

export type ProxyScheme = 'http' | 'https';
export type ProxyStatus = 'disabled' | 'idle' | 'ok' | 'degraded' | 'failing';
export type ProxyDebug = 'off' | '1h' | '24h' | '7d' | 'forever';
export type ProxyTargetType = 'provider' | 'connection' | 'trigger' | 'email_config';
export type ProxySourceType = ProxyTargetType | 'test';

export const PROXY_RESULT_CODES = [
  'ok',
  'refused',
  'timeout',
  'auth_407',
  'tls',
  'connect_status',
  'dns',
  'blocked',
  'upstream_429',
  'error',
] as const;

export const PROXY_SOURCE_TYPES: ProxySourceType[] = [
  'provider',
  'connection',
  'trigger',
  'email_config',
  'test',
];

export interface ProxyStats7d {
  connections: number;
  successes: number;
  failures: number;
  avg_tunnel_ms: number | null;
  bytes_sent: number;
  bytes_received: number;
}

export interface ProxyView {
  id: string;
  name: string;
  scheme: ProxyScheme;
  host: string;
  port: number;
  username: string | null;
  has_password: boolean;
  enabled: boolean;
  connect_timeout_ms: number;
  debug_enabled: boolean;
  /** Null with `debug_enabled` means no time limit. */
  debug_until: string | null;
  log_retention_days: number | null;
  status: ProxyStatus;
  binding_count: number;
  stats_7d: ProxyStats7d | null;
  created_at: string;
  updated_at: string;
}

export interface BindingRef {
  target_type: ProxyTargetType;
  target_id: string;
  label: string;
  /** True when removing this proxy leaves the object with no proxy in its chain. */
  loses_proxy: boolean;
}

export interface ProxyDetail extends ProxyView {
  bindings: BindingRef[];
  suggested_test_url: string | null;
}

export interface ProxyWrite {
  name?: string;
  scheme?: ProxyScheme;
  host?: string;
  port?: number;
  username?: string;
  /** Empty or absent keeps the stored password. */
  password?: string;
  /** 'none' clears the username and password. */
  auth?: 'none';
  enabled?: boolean;
  connect_timeout_ms?: number;
  debug?: ProxyDebug;
  log_retention_days?: number | null;
}

export interface ProxyTestResult {
  ok: boolean;
  result: string;
  status: number | null;
  tunnel_ms: number | null;
  total_ms: number;
  error: string | null;
}

export interface ProxyLog {
  id: string;
  proxy_name: string;
  started_at: string;
  duration_ms: number;
  tunnel_ms: number | null;
  source_type: ProxySourceType;
  source_id: string | null;
  source_label: string | null;
  destination: string;
  position: number;
  result: string;
  status_code: number | null;
  bytes_sent: number;
  bytes_received: number;
  request_id: string | null;
  agent_message_id: string | null;
  error: string | null;
}

export interface ProxyLogFilters {
  result?: string;
  source_type?: string;
  from?: string;
  to?: string;
  before?: string;
  limit?: number;
}

export interface ProxyStats {
  days: number;
  daily: Array<{
    day: string;
    connections: number;
    successes: number;
    failures: number;
    avg_tunnel_ms: number | null;
    max_tunnel_ms: number | null;
    bytes_sent: number;
    bytes_received: number;
    fallback_uses: number;
  }>;
  by_source: Array<{
    source_type: ProxySourceType;
    source_id: string | null;
    label: string | null;
    connections: number;
    successes: number;
    failures: number;
    bytes_sent: number;
    bytes_received: number;
    fallback_uses: number;
  }>;
  failures_by_code: Record<string, number>;
}

export interface ChainItem {
  kind: 'proxy' | 'direct';
  proxy_id: string | null;
  name: string;
  enabled: boolean;
}

export type EffectiveSource = ProxyTargetType | 'global' | 'direct';

export interface ProxyBinding {
  target_type: ProxyTargetType;
  target_id: string;
  mode: 'own' | 'inherit';
  chain: ChainItem[];
  /** Connections only: the provider's chain. */
  inherited_chain?: ChainItem[];
  effective: { source: EffectiveSource; chain: ChainItem[]; global?: string };
}

/** Where one attempt (or trigger delivery) left Thinker. */
export interface Egress {
  kind: 'proxy' | 'direct' | 'global';
  proxy_id: string | null;
  name: string | null;
}

export interface EgressHop extends Egress {
  position: number;
  result: string;
  ms: number | null;
  tunnel_ms: number | null;
  status: number | null;
  error?: string | null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const id = (value: string) => encodeURIComponent(value);

export function listProxies() {
  return fetchJson<{ proxies: ProxyView[]; global: { url: string; no_proxy: string[] } | null }>(
    '/proxy-servers',
    undefined,
    { cache: false },
  );
}

export function getProxy(proxyId: string) {
  return fetchJson<ProxyDetail>(`/proxy-servers/${id(proxyId)}`, undefined, { cache: false });
}

export function createProxy(data: ProxyWrite) {
  return fetchMutate<ProxyDetail>('/proxy-servers', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
}

export function updateProxy(proxyId: string, data: ProxyWrite) {
  return fetchMutate<ProxyDetail>(`/proxy-servers/${id(proxyId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
}

/**
 * Deletes a proxy. Without `mode`, a bound proxy is refused with a 409 (the
 * caller then asks to remove it from every chain or replace it).
 */
export function deleteProxy(
  proxyId: string,
  opts: { mode?: 'remove' | 'replace'; replaceWith?: string } = {},
  mutate?: FetchMutateOptions,
) {
  const qs = new URLSearchParams();
  if (opts.mode) qs.set('mode', opts.mode);
  if (opts.replaceWith) qs.set('replace_with', opts.replaceWith);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return fetchMutate<{ deleted: true; affected: number }>(
    `/proxy-servers/${id(proxyId)}${suffix}`,
    { method: 'DELETE' },
    mutate,
  );
}

export function testProxy(proxyId: string, url: string) {
  return fetchMutate<ProxyTestResult>(`/proxy-servers/${id(proxyId)}/test`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ url }),
  });
}

export function listProxyLogs(proxyId: string, filters: ProxyLogFilters = {}) {
  return fetchJson<{ logs: ProxyLog[]; next_before: string | null }>(
    `/proxy-servers/${id(proxyId)}/logs`,
    {
      result: filters.result,
      source_type: filters.source_type,
      from: filters.from,
      to: filters.to,
      before: filters.before,
      limit: String(filters.limit ?? 50),
    },
    { cache: false },
  );
}

export function getProxyStats(proxyId: string, days: number) {
  return fetchJson<ProxyStats>(
    `/proxy-servers/${id(proxyId)}/stats`,
    { days: String(days) },
    { cache: false },
  );
}

export function getProxyBinding(targetType: ProxyTargetType, targetId: string) {
  return fetchJson<ProxyBinding>(`/proxy-bindings/${id(targetType)}/${id(targetId)}`, undefined, {
    cache: false,
  });
}

/** `chain` is proxy ids and 'direct'; `[]` removes the binding. */
export function setProxyBinding(targetType: ProxyTargetType, targetId: string, chain: string[]) {
  return fetchMutate<ProxyBinding>(`/proxy-bindings/${id(targetType)}/${id(targetId)}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ chain }),
  });
}

export const proxyPath = (proxyId: string) => `/proxy-servers/${encodeURIComponent(proxyId)}`;
