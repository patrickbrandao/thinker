import { ConflictException } from '@nestjs/common';
import { ProxyEgressService } from './proxy-egress.service';
import { ProxyServersService, rewriteChain, validateChain } from './proxy-servers.service';
import type { HopEvent } from '../common/outbound/outbound-proxy';

describe('validateChain', () => {
  const known = new Set(['a', 'b', 'c']);

  it('accepts a proxy first, then proxies and one "direct" anywhere after', () => {
    expect(validateChain(['a', 'direct', 'b'], known)).toEqual(['a', null, 'b']);
    expect(validateChain(['a', 'b', 'direct'], known)).toEqual(['a', 'b', null]);
    expect(validateChain([], known)).toEqual([]);
  });

  it('rejects direct first, direct twice, repeats, unknown ids and long chains', () => {
    expect(() => validateChain(['direct', 'a'], known)).toThrow();
    expect(() => validateChain(['a', 'direct', 'direct'], known)).toThrow();
    expect(() => validateChain(['a', 'a'], known)).toThrow();
    expect(() => validateChain(['zzz'], known)).toThrow();
    expect(() => validateChain(['a', 'b', 'c', 'direct', 'a', 'b', 'c'], known)).toThrow();
  });
});

describe('rewriteChain', () => {
  it('removes the proxy position and keeps the order', () => {
    expect(rewriteChain(['a', 'b', null], 'b', null)).toEqual(['a', null]);
  });

  it('drops the whole chain when no proxy is left', () => {
    expect(rewriteChain(['a'], 'a', null)).toBeNull();
    expect(rewriteChain(['a', null], 'a', null)).toBeNull();
  });

  it('keeps a proxy first when the removed one was first', () => {
    expect(rewriteChain(['a', null, 'b'], 'a', null)).toEqual(['b', null]);
  });

  it('replaces in place and removes the duplicate when the substitute is already there', () => {
    expect(rewriteChain(['a', 'b'], 'a', 'c')).toEqual(['c', 'b']);
    expect(rewriteChain(['a', 'b', null], 'a', 'b')).toEqual(['b', null]);
  });
});

describe('ProxyServersService.remove', () => {
  const row = {
    id: 'p1',
    tenant_id: 't1',
    name: 'A',
    scheme: 'http',
    host: 'proxy',
    port: 3128,
    username: null,
    password_encrypted: null,
    enabled: true,
    connect_timeout_ms: 10000,
    debug_enabled: false,
    debug_until: null,
    log_retention_days: null,
    created_at: '2026-11-01',
    updated_at: '2026-11-01',
  };

  function build(bindingRows: Array<Record<string, unknown>>) {
    const executed: Array<[string, unknown[]]> = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      executed.push([sql, params]);
      if (sql.includes('FROM proxy_servers WHERE tenant_id')) return [row];
      if (sql.includes('FROM proxy_bindings b')) return bindingRows;
      if (sql.includes('FROM tenant_providers')) {
        return [{ id: 'conn1', provider: 'openai', label: 'Default' }];
      }
      return [];
    });
    const manager = { query };
    const ds = { query, transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)) };
    const egress = { invalidate: jest.fn() } as unknown as ProxyEgressService;
    return { service: new ProxyServersService(ds as never, egress), executed, egress };
  }

  const bound = [
    { target_type: 'connection', target_id: 'conn1', position: 1, proxy_id: 'p1' },
    { target_type: 'provider', target_id: 'openai', position: 1, proxy_id: 'p1' },
    { target_type: 'provider', target_id: 'openai', position: 2, proxy_id: 'p2' },
  ];

  it('refuses with 409 and lists the bindings', async () => {
    const { service } = build(bound);
    const err = await service.remove('t1', 'p1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as { bindings: unknown[] };
    expect(body.bindings).toEqual([
      {
        target_type: 'connection',
        target_id: 'conn1',
        label: 'openai / Default',
        loses_proxy: true,
      },
      { target_type: 'provider', target_id: 'openai', label: 'openai', loses_proxy: false },
    ]);
  });

  it('"remove from all" rewrites every chain and deletes the proxy in one transaction', async () => {
    const { service, executed, egress } = build(bound);
    await expect(service.remove('t1', 'p1', 'remove')).resolves.toEqual({
      deleted: true,
      affected: 2,
    });
    const inserts = executed.filter(([sql]) => sql.includes('INSERT INTO proxy_bindings'));
    expect(inserts.map(([, p]) => p)).toEqual([['t1', 'provider', 'openai', 1, 'p2']]);
    expect(executed.at(-1)![0]).toContain('DELETE FROM proxy_servers');
    expect(egress.invalidate).toHaveBeenCalledWith('t1');
  });
});

describe('ProxyEgressService.record (daily rollup)', () => {
  function event(result: HopEvent['hop']['result'], debug = false, position = 1): HopEvent {
    return {
      scope: {
        tenantId: 't1',
        sourceType: 'connection',
        sourceId: 'c1',
        sourceLabel: 'openai / Default',
        chain: null,
        hops: [],
      },
      hop: {
        kind: 'proxy',
        proxy_id: 'p1',
        name: 'A',
        position,
        result,
        ms: 12,
        tunnel_ms: result === 'ok' ? 5 : null,
        status: result === 'ok' ? 200 : null,
      },
      proxy: {
        id: 'p1',
        name: 'A',
        scheme: 'http',
        host: 'proxy',
        port: 3128,
        username: null,
        password: null,
        enabled: true,
        connectTimeoutMs: 1000,
        debug,
        version: 'v',
      },
      destination: 'api.openai.com:443',
      startedAt: new Date('2026-11-01T10:00:00Z'),
      bytesSent: 100,
      bytesReceived: 200,
    };
  }

  it('counts successes without a log row unless debug is on', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new ProxyEgressService({ query } as never);
    await service.record(event('ok'));
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO proxy_usage_daily');
    expect(params.slice(0, 9)).toEqual([
      't1',
      'p1',
      'A',
      '2026-11-01',
      'connection',
      'c1',
      1,
      0,
      '{}',
    ]);
    expect(params.slice(9, 15)).toEqual([5, 5, 1, 100, 200, 0]);

    query.mockClear();
    await service.record(event('ok', true));
    expect(query.mock.calls[0]![0]).toContain('INSERT INTO proxy_logs');
  });

  it('logs failures and counts them by code and as fallback uses', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new ProxyEgressService({ query } as never);
    await service.record(event('auth_407', false, 2));
    expect(query.mock.calls[0]![0]).toContain('INSERT INTO proxy_logs');
    const params = query.mock.calls[1]![1] as unknown[];
    expect(params.slice(6, 9)).toEqual([0, 1, JSON.stringify({ auth_407: 1 })]);
    expect(params[14]).toBe(1);
    expect(params[15]).toBe('auth_407');
  });
});
