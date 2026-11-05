import type {
  ProxyDetail,
  ProxyLog,
  ProxyProfile,
  ProxyStats,
  ProxyView,
} from '../../../src/services/api/proxies';

/** Shared builders for the outbound proxy tests. */

export function proxyView(over: Partial<ProxyView> = {}): ProxyView {
  return {
    id: 'p1',
    name: 'Alpha',
    scheme: 'http',
    host: 'proxy-a.example.com',
    port: 3128,
    username: null,
    has_password: false,
    enabled: true,
    connect_timeout_ms: 10000,
    debug_enabled: false,
    debug_until: null,
    log_retention_days: null,
    status: 'ok',
    binding_count: 0,
    stats_7d: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

export function proxyDetail(over: Partial<ProxyDetail> = {}): ProxyDetail {
  return {
    ...proxyView(),
    bindings: [],
    suggested_test_url: null,
    ...over,
  };
}

export function profile(over: Partial<ProxyProfile> = {}): ProxyProfile {
  return {
    id: 'pr1',
    name: 'Primary route',
    chain: [
      { kind: 'proxy', proxy_id: 'p1', name: 'Alpha', enabled: true },
      { kind: 'direct', proxy_id: null, name: 'Direct', enabled: true },
    ],
    used_by: [],
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

export function proxyLog(over: Partial<ProxyLog> = {}): ProxyLog {
  return {
    id: 'l1',
    proxy_name: 'Alpha',
    started_at: '2026-10-02T10:00:00.000Z',
    duration_ms: 420,
    tunnel_ms: 35,
    source_type: 'provider',
    source_id: 'api_key:openai',
    source_label: 'OpenAI',
    destination: 'api.openai.com:443',
    position: 1,
    result: 'ok',
    status_code: 200,
    bytes_sent: 1024,
    bytes_received: 2 * 1024 * 1024,
    request_id: null,
    agent_message_id: null,
    error: null,
    ...over,
  };
}

export function proxyStats(over: Partial<ProxyStats> = {}): ProxyStats {
  return {
    days: 30,
    daily: [
      {
        day: '2026-10-01',
        connections: 10,
        successes: 8,
        failures: 2,
        avg_tunnel_ms: 40,
        max_tunnel_ms: 90,
        bytes_sent: 2048,
        bytes_received: 4096,
        fallback_uses: 1,
      },
      {
        day: '2026-10-02',
        connections: 5,
        successes: 5,
        failures: 0,
        avg_tunnel_ms: 20,
        max_tunnel_ms: 60,
        bytes_sent: 1024,
        bytes_received: 1024,
        fallback_uses: 0,
      },
    ],
    by_source: [
      {
        source_type: 'provider',
        source_id: 'api_key:openai',
        label: 'OpenAI',
        connections: 12,
        successes: 10,
        failures: 2,
        bytes_sent: 1024,
        bytes_received: 2048,
        fallback_uses: 1,
      },
      {
        source_type: 'trigger',
        source_id: null,
        label: null,
        connections: 3,
        successes: 3,
        failures: 0,
        bytes_sent: 0,
        bytes_received: 0,
        fallback_uses: 0,
      },
    ],
    failures_by_code: { timeout: 1, auth_407: 3 },
    ...over,
  };
}
