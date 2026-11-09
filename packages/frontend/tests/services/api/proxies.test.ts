import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../../../src/services/toast-store.js', () => ({ toast: toastMock }));

import * as proxies from '../../../src/services/api/proxies';
import { ApiError } from '../../../src/services/api/core';

function setupFetch(response: unknown = {}, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => response,
    text: async () => (typeof response === 'string' ? response : JSON.stringify(response)),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const call = (fetchMock: ReturnType<typeof vi.fn>, n = 0) => {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit | undefined];
  const parsed = new URL(url, 'http://localhost');
  return {
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams.entries()),
    method: init?.method ?? 'GET',
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
    rawBody: init?.body,
    init,
  };
};

describe('proxies API client', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/' } });
    toastMock.error.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('proxy servers', () => {
    it('listProxies GETs /proxy-servers with credentials and returns the payload', async () => {
      const f = setupFetch({ proxies: [{ id: 'p1' }], global: null });
      expect(await proxies.listProxies()).toEqual({ proxies: [{ id: 'p1' }], global: null });
      const c = call(f);
      expect(c.path).toBe('/api/v1/proxy-servers');
      expect(c.method).toBe('GET');
      expect(c.init?.credentials).toBe('include');
    });

    it('never serves a list from the cache (fresh GET every time)', async () => {
      const f = setupFetch({ proxies: [], global: null });
      await proxies.listProxies();
      await proxies.listProxies();
      expect(f).toHaveBeenCalledTimes(2);
    });

    it('getProxy encodes the id into the path', async () => {
      const f = setupFetch({ id: 'a/b c' });
      await proxies.getProxy('a/b c');
      expect(call(f).path).toBe('/api/v1/proxy-servers/a%2Fb%20c');
    });

    it('createProxy POSTs the JSON body untouched', async () => {
      const f = setupFetch({ id: 'p1' });
      const data = { name: 'A', scheme: 'https' as const, host: 'h', port: 8443, username: 'u', password: 'secret' };
      await proxies.createProxy(data);
      const c = call(f);
      expect(c.path).toBe('/api/v1/proxy-servers');
      expect(c.method).toBe('POST');
      expect(c.headers['Content-Type']).toBe('application/json');
      expect(c.body).toEqual(data);
    });

    it('updateProxy PATCHes by id with only the given fields', async () => {
      const f = setupFetch({ id: 'p1' });
      await proxies.updateProxy('p1', { enabled: false });
      const c = call(f);
      expect(c.path).toBe('/api/v1/proxy-servers/p1');
      expect(c.method).toBe('PATCH');
      expect(c.body).toEqual({ enabled: false });
    });

    it('updateProxy can clear authentication and set a debug window', async () => {
      const f = setupFetch({ id: 'p1' });
      await proxies.updateProxy('p1', { auth: 'none', debug: '24h', log_retention_days: null });
      expect(call(f).body).toEqual({ auth: 'none', debug: '24h', log_retention_days: null });
    });

    it('deleteProxy without options sends a bare DELETE (a bound proxy is refused by the server)', async () => {
      const f = setupFetch({ deleted: true, affected: 0 });
      await proxies.deleteProxy('p1');
      const c = call(f);
      expect(c.path).toBe('/api/v1/proxy-servers/p1');
      expect(c.query).toEqual({});
      expect(c.method).toBe('DELETE');
      expect(c.rawBody).toBeUndefined();
    });

    it('deleteProxy passes mode=remove and mode=replace with replace_with', async () => {
      const f = setupFetch({ deleted: true, affected: 2 });
      await proxies.deleteProxy('p1', { mode: 'remove' });
      expect(call(f, 0).query).toEqual({ mode: 'remove' });
      await proxies.deleteProxy('p1', { mode: 'replace', replaceWith: 'p 2' });
      expect(call(f, 1).query).toEqual({ mode: 'replace', replace_with: 'p 2' });
      expect((f.mock.calls[1] as [string])[0]).toContain('replace_with=p+2');
    });

    it('deleteProxy returns the affected count', async () => {
      setupFetch({ deleted: true, affected: 3 });
      expect(await proxies.deleteProxy('p1', { mode: 'remove' })).toEqual({ deleted: true, affected: 3 });
    });

    it('a 409 on delete becomes an ApiError with the status; silent mode skips the toast', async () => {
      setupFetch({ message: 'Proxy is in use' }, 409);
      const err = await proxies.deleteProxy('p1', {}, { silent: true }).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(409);
      expect(err.message).toBe('Proxy is in use');
      expect(toastMock.error).not.toHaveBeenCalled();
    });

    it('without silent, a failed mutation toasts the backend message', async () => {
      setupFetch({ message: 'Host is not allowed' }, 400);
      await expect(proxies.createProxy({ name: 'x' })).rejects.toThrow('Host is not allowed');
      expect(toastMock.error).toHaveBeenCalledWith('Host is not allowed');
    });

    it('testProxy POSTs the URL to /test', async () => {
      const f = setupFetch({ ok: true, result: 'ok', status: 200, tunnel_ms: 5, total_ms: 9, error: null });
      const res = await proxies.testProxy('p1', 'https://api.openai.com/');
      const c = call(f);
      expect(c.path).toBe('/api/v1/proxy-servers/p1/test');
      expect(c.method).toBe('POST');
      expect(c.body).toEqual({ url: 'https://api.openai.com/' });
      expect(res.ok).toBe(true);
    });

    it('listProxyLogs defaults to 50 rows and sends only the filters that are set', async () => {
      const f = setupFetch({ logs: [], next_before: null });
      await proxies.listProxyLogs('p1');
      expect(call(f, 0).path).toBe('/api/v1/proxy-servers/p1/logs');
      expect(call(f, 0).query).toEqual({ limit: '50' });
      await proxies.listProxyLogs('p1', {
        result: 'timeout',
        source_type: 'trigger',
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
        before: 'cursor',
        limit: 10,
      });
      expect(call(f, 1).query).toEqual({
        result: 'timeout',
        source_type: 'trigger',
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
        before: 'cursor',
        limit: '10',
      });
    });

    it('getProxyStats sends the number of days', async () => {
      const f = setupFetch({ days: 7, daily: [], by_source: [], failures_by_code: {} });
      await proxies.getProxyStats('p1', 7);
      expect(call(f).path).toBe('/api/v1/proxy-servers/p1/stats');
      expect(call(f).query).toEqual({ days: '7' });
    });
  });

  describe('outbound profiles', () => {
    it('listProxyProfiles GETs /proxy-profiles', async () => {
      const f = setupFetch({ profiles: [] });
      expect(await proxies.listProxyProfiles()).toEqual({ profiles: [] });
      expect(call(f).path).toBe('/api/v1/proxy-profiles');
    });

    it('createProxyProfile POSTs name and chain (proxy ids and "direct")', async () => {
      const f = setupFetch({ id: 'pr1' });
      await proxies.createProxyProfile({ name: 'Edge', chain: ['p1', 'direct'] });
      const c = call(f);
      expect(c.path).toBe('/api/v1/proxy-profiles');
      expect(c.method).toBe('POST');
      expect(c.body).toEqual({ name: 'Edge', chain: ['p1', 'direct'] });
    });

    it('updateProxyProfile PATCHes by id', async () => {
      const f = setupFetch({ id: 'pr 1' });
      await proxies.updateProxyProfile('pr 1', { name: 'Edge', chain: ['p2'] });
      const c = call(f);
      expect(c.path).toBe('/api/v1/proxy-profiles/pr%201');
      expect(c.method).toBe('PATCH');
      expect(c.body).toEqual({ name: 'Edge', chain: ['p2'] });
    });

    it('deleteProxyProfile only forces removal when asked', async () => {
      const f = setupFetch({ deleted: true, affected: 0 });
      await proxies.deleteProxyProfile('pr1');
      expect(call(f, 0).query).toEqual({});
      expect(call(f, 0).method).toBe('DELETE');
      await proxies.deleteProxyProfile('pr1', true);
      expect(call(f, 1).query).toEqual({ mode: 'remove' });
    });
  });

  describe('assignments', () => {
    it('listProxyAssignments filters by target type only when given', async () => {
      const f = setupFetch({ assignments: [] });
      await proxies.listProxyAssignments();
      expect(call(f, 0).path).toBe('/api/v1/proxy-assignments');
      expect(call(f, 0).query).toEqual({});
      await proxies.listProxyAssignments('provider');
      expect(call(f, 1).query).toEqual({ target_type: 'provider' });
    });

    it('getProxyAssignment encodes the type and the target id (colons included)', async () => {
      const f = setupFetch({ mode: 'inherit' });
      await proxies.getProxyAssignment('provider', 'api_key:openai');
      expect((f.mock.calls[0] as [string])[0]).toContain('/api/v1/proxy-assignments/provider/api_key%3Aopenai');
    });

    it('setProxyAssignment PUTs the mode and the profile id', async () => {
      const f = setupFetch({ mode: 'profile' });
      await proxies.setProxyAssignment('trigger', 't1', 'profile', 'pr1');
      const c = call(f);
      expect(c.path).toBe('/api/v1/proxy-assignments/trigger/t1');
      expect(c.method).toBe('PUT');
      expect(c.headers['Content-Type']).toBe('application/json');
      expect(c.body).toEqual({ mode: 'profile', profile_id: 'pr1' });
    });

    it('setProxyAssignment omits profile_id for modes that have none', async () => {
      const f = setupFetch({ mode: 'direct' });
      await proxies.setProxyAssignment('connection', 'c1', 'direct', null);
      expect(call(f, 0).rawBody).toBe(JSON.stringify({ mode: 'direct' }));
      await proxies.setProxyAssignment('connection', 'c1', 'inherit');
      expect(call(f, 1).rawBody).toBe(JSON.stringify({ mode: 'inherit' }));
    });
  });

  describe('constants', () => {
    it('proxyPath builds the dashboard route of a proxy and encodes the id', () => {
      expect(proxies.proxyPath('p1')).toBe('/proxy-servers/p1');
      expect(proxies.proxyPath('a/b')).toBe('/proxy-servers/a%2Fb');
    });

    it('lists every result code and source type the log filters offer', () => {
      expect(proxies.PROXY_RESULT_CODES).toContain('auth_407');
      expect(proxies.PROXY_RESULT_CODES).toContain('upstream_429');
      expect(new Set(proxies.PROXY_RESULT_CODES).size).toBe(proxies.PROXY_RESULT_CODES.length);
      expect(proxies.PROXY_SOURCE_TYPES).toEqual(['provider', 'connection', 'trigger', 'email_config', 'test']);
    });
  });
});
