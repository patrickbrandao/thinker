import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { Logger } from '@nestjs/common';
import {
  ProxyEgressService,
  authKindOf,
  decryptProxyPassword,
  defaultTargetOf,
  isDebugActive,
  providerTargetId,
  toOutboundProxy,
  type ProxyServerRow,
} from './proxy-egress.service';
import { encrypt, getEncryptionSecret } from '../common/utils/crypto.util';
import * as outbound from '../common/outbound/outbound-proxy';
import {
  clearProxyAgentCache,
  currentOutboundScope,
  isProviderProxyFailedError,
  outboundFetch,
  parseGlobalProxyEnv,
  runWithOutboundScope,
  setGlobalProxyConfigForTests,
  setOutboundHopSink,
  type HopEvent,
  type OutboundScope,
} from '../common/outbound/outbound-proxy';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const T1 = 'tenant-1';
const T2 = 'tenant-2';
const SECRET = 'S3cr3t-pa55-never-leaks';
const now = '2026-11-01T00:00:00.000Z';

function server(over: Partial<ProxyServerRow> & Row = {}): ProxyServerRow {
  return {
    id: 'p1',
    tenant_id: T1,
    name: 'A',
    scheme: 'http',
    host: '127.0.0.1',
    port: 3128,
    username: null,
    password_encrypted: null,
    enabled: true,
    connect_timeout_ms: 2000,
    debug_enabled: false,
    debug_until: null,
    log_retention_days: null,
    created_at: now,
    updated_at: now,
    ...over,
  };
}

interface Tables {
  servers: ProxyServerRow[];
  /** profile id -> chain (proxy id or null for Direct) */
  profiles: Record<string, Array<string | null>>;
  assignments: Array<{
    target_type: string;
    target_id: string;
    mode: string;
    profile_id: string | null;
  }>;
  connections: Array<{ id: string; provider: string; auth_type: string; label: string }>;
  locals: Array<{ id: string; local_type: string }>;
}

/** Answers the five statements of a snapshot load, per tenant, and counts them. */
function fakeDs(byTenant: Record<string, Partial<Tables>>) {
  const loads: string[] = [];
  const state = { failing: false, delayMs: 0 };
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    const tenant = String(params[0]);
    const t = byTenant[tenant] ?? {};
    if (/FROM proxy_servers/.test(sql)) {
      loads.push(tenant);
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (state.failing) throw new Error('connection terminated');
      return (t.servers ?? []).filter((s) => s.tenant_id === tenant);
    }
    if (state.failing) throw new Error('connection terminated');
    if (/FROM proxy_bindings/.test(sql)) {
      return Object.entries(t.profiles ?? {}).flatMap(([target_id, chain]) =>
        chain.map((proxy_id, i) => ({ target_id, position: i + 1, proxy_id })),
      );
    }
    if (/FROM proxy_assignments/.test(sql)) return t.assignments ?? [];
    if (/FROM tenant_providers/.test(sql)) return t.connections ?? [];
    if (/FROM custom_providers/.test(sql)) return t.locals ?? [];
    if (/^INSERT|^UPDATE/.test(sql.trim())) return [];
    return [];
  });
  return { ds: { query } as never, query, loads, state };
}

const kinds = (chain: unknown) =>
  (chain as Array<{ kind: string; proxy?: { id: string } }> | null)?.map((i) =>
    i.kind === 'proxy' ? `proxy:${i.proxy!.id}` : i.kind,
  ) ?? null;

afterEach(async () => {
  setOutboundHopSink(null);
  setGlobalProxyConfigForTests(null);
  jest.restoreAllMocks();
  await clearProxyAgentCache();
});

describe('helpers', () => {
  it('providerTargetId lower-cases the provider', () => {
    expect(providerTargetId('api_key', 'OpenAI')).toBe('api_key:openai');
  });

  it('authKindOf maps unknown and missing auth types to usage-based', () => {
    expect(authKindOf('local')).toBe('local');
    expect(authKindOf('subscription')).toBe('subscription');
    expect(authKindOf('api_key')).toBe('api_key');
    expect(authKindOf(null)).toBe('api_key');
    expect(authKindOf(undefined)).toBe('api_key');
    expect(authKindOf('something-new')).toBe('api_key');
  });

  it('defaultTargetOf uses the local server type only for local connections', () => {
    expect(defaultTargetOf('local', 'custom:abc', 'ollama')).toBe('local:ollama');
    expect(defaultTargetOf('local', 'custom:abc', null)).toBe('local:custom:abc');
    expect(defaultTargetOf('api_key', 'openai', 'ollama')).toBe('api_key:openai');
  });

  it('isDebugActive honors the expiry', () => {
    expect(isDebugActive({ debug_enabled: false, debug_until: null })).toBe(false);
    expect(isDebugActive({ debug_enabled: true, debug_until: null })).toBe(true);
    expect(
      isDebugActive({
        debug_enabled: true,
        debug_until: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe(true);
    expect(
      isDebugActive({ debug_enabled: true, debug_until: new Date(Date.now() - 1).toISOString() }),
    ).toBe(false);
  });

  it('toOutboundProxy decrypts the password and versions the proxy by updated_at', () => {
    const row = server({
      username: 'alice',
      password_encrypted: encrypt(SECRET, getEncryptionSecret()),
      scheme: 'https',
      port: '8443' as never,
      connect_timeout_ms: '1500' as never,
    });
    expect(toOutboundProxy(row)).toMatchObject({
      id: 'p1',
      scheme: 'https',
      port: 8443,
      username: 'alice',
      password: SECRET,
      connectTimeoutMs: 1500,
      enabled: true,
      debug: false,
      version: now,
    });
    expect(toOutboundProxy({ ...row, updated_at: '2026-11-02T00:00:00.000Z' }).version).not.toBe(
      now,
    );
  });

  it('toOutboundProxy treats an undecryptable password as none and an odd scheme as http', () => {
    const row = server({
      username: 'alice',
      password_encrypted: 'garbage',
      scheme: 'socks' as never,
    });
    expect(toOutboundProxy(row)).toMatchObject({ password: null, scheme: 'http' });
    expect(
      decryptProxyPassword(encrypt('x', 'another-secret-another-secret-another-secret')),
    ).toBeNull();
  });
});

describe('snapshot cache', () => {
  const tables = {
    servers: [server()],
    profiles: { pr1: ['p1'] },
    assignments: [],
    connections: [],
  };

  it('loads once per workspace and reuses it', async () => {
    const { ds, loads } = fakeDs({ [T1]: tables });
    const egress = new ProxyEgressService(ds);
    await egress.chainFor(T1, 'trigger', 'x');
    await egress.scopeForConnection(T1, 'openai', null);
    await egress.scopeForTarget(T1, 'trigger', 'x', 'Hook');
    expect(loads).toEqual([T1]);
  });

  it('shares one load between concurrent callers', async () => {
    const fake = fakeDs({ [T1]: tables });
    fake.state.delayMs = 20;
    const egress = new ProxyEgressService(fake.ds);
    await Promise.all(
      Array.from({ length: 10 }, () => egress.scopeForConnection(T1, 'openai', null)),
    );
    expect(fake.loads).toEqual([T1]);
  });

  it('keeps the workspaces apart: each is loaded with its own tenant id', async () => {
    const { ds, loads, query } = fakeDs({
      [T1]: {
        ...tables,
        assignments: [
          { target_type: 'trigger', target_id: 'hook', mode: 'profile', profile_id: 'pr1' },
        ],
      },
      [T2]: {
        servers: [server({ id: 'q1', tenant_id: T2 })],
        profiles: { pr1: ['q1'] },
        assignments: [],
      },
    });
    const egress = new ProxyEgressService(ds);
    // The same target id in two workspaces resolves independently.
    expect(kinds(await egress.chainFor(T1, 'trigger', 'hook'))).toEqual(['proxy:p1']);
    expect(await egress.chainFor(T2, 'trigger', 'hook')).toBeNull();
    expect(loads.sort()).toEqual([T1, T2]);
    for (const [sql, params] of query.mock.calls) {
      if (/FROM (proxy_|tenant_providers|custom_providers)/.test(sql)) {
        expect([T1, T2]).toContain(params![0]);
      }
    }
  });

  it('reloads after invalidate, only for that workspace', async () => {
    const { ds, loads } = fakeDs({ [T1]: tables, [T2]: tables });
    const egress = new ProxyEgressService(ds);
    await egress.chainFor(T1, 'trigger', 'x');
    await egress.chainFor(T2, 'trigger', 'x');
    egress.invalidate(T1);
    await egress.chainFor(T1, 'trigger', 'x');
    await egress.chainFor(T2, 'trigger', 'x');
    expect(loads).toEqual([T1, T2, T1]);
  });

  it('picks up a changed assignment after invalidate', async () => {
    const t: Partial<Tables> = { ...tables, assignments: [] };
    const { ds } = fakeDs({ [T1]: t });
    const egress = new ProxyEgressService(ds);
    expect(await egress.chainFor(T1, 'trigger', 'hook')).toBeNull();
    t.assignments = [
      { target_type: 'trigger', target_id: 'hook', mode: 'direct', profile_id: null },
    ];
    expect(await egress.chainFor(T1, 'trigger', 'hook')).toBeNull(); // still cached
    egress.invalidate(T1);
    expect(kinds(await egress.chainFor(T1, 'trigger', 'hook'))).toEqual(['direct']);
  });

  it('reloads once the 30 s TTL has passed', async () => {
    const { ds, loads } = fakeDs({ [T1]: tables });
    const egress = new ProxyEgressService(ds);
    const realNow = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(realNow);
    await egress.chainFor(T1, 'trigger', 'x');
    spy.mockReturnValue(realNow + 29_000);
    await egress.chainFor(T1, 'trigger', 'x');
    expect(loads).toHaveLength(1);
    spy.mockReturnValue(realNow + 31_000);
    await egress.chainFor(T1, 'trigger', 'x');
    expect(loads).toHaveLength(2);
  });

  it('serves the last good snapshot when a reload fails (stale beats direct)', async () => {
    const fake = fakeDs({
      [T1]: {
        ...tables,
        assignments: [
          { target_type: 'trigger', target_id: 'hook', mode: 'profile', profile_id: 'pr1' },
        ],
      },
    });
    const egress = new ProxyEgressService(fake.ds);
    expect(kinds(await egress.chainFor(T1, 'trigger', 'hook'))).toEqual(['proxy:p1']);
    egress.invalidate(T1);
    fake.state.failing = true;
    expect(kinds(await egress.chainFor(T1, 'trigger', 'hook'))).toEqual(['proxy:p1']);
    fake.state.failing = false;
    egress.invalidate(T1);
    expect(kinds(await egress.chainFor(T1, 'trigger', 'hook'))).toEqual(['proxy:p1']);
  });

  it('does not cache a failed first load: the next call retries', async () => {
    const fake = fakeDs({ [T1]: tables });
    fake.state.failing = true;
    const egress = new ProxyEgressService(fake.ds);
    await expect(egress.chainFor(T1, 'trigger', 'x')).rejects.toThrow('connection terminated');
    fake.state.failing = false;
    await expect(egress.chainFor(T1, 'trigger', 'x')).resolves.toBeNull();
    expect(fake.loads).toHaveLength(2);
  });
});

describe('chain resolution', () => {
  function egressWith(t: Partial<Tables>) {
    return new ProxyEgressService(fakeDs({ [T1]: t }).ds);
  }
  const a = server({ id: 'a', name: 'A' });
  const b = server({ id: 'b', name: 'B', enabled: false });

  it('a profile chain keeps order, the Direct item and disabled servers (skipped at connect time)', async () => {
    const egress = egressWith({
      servers: [a, b],
      profiles: { pr: ['a', 'b', null] },
      assignments: [{ target_type: 'trigger', target_id: 't', mode: 'profile', profile_id: 'pr' }],
    });
    const chain = await egress.chainFor(T1, 'trigger', 't');
    expect(kinds(chain)).toEqual(['proxy:a', 'proxy:b', 'direct']);
    expect((chain![1] as { proxy: { enabled: boolean } }).proxy.enabled).toBe(false);
  });

  it('decrypts the proxy password into the chain without exposing the ciphertext', async () => {
    const stored = server({
      id: 'a',
      username: 'alice',
      password_encrypted: encrypt(SECRET, getEncryptionSecret()),
    });
    const egress = egressWith({
      servers: [stored],
      profiles: { pr: ['a'] },
      assignments: [{ target_type: 'trigger', target_id: 't', mode: 'profile', profile_id: 'pr' }],
    });
    const chain = await egress.chainFor(T1, 'trigger', 't');
    expect((chain![0] as { proxy: { password: string } }).proxy.password).toBe(SECRET);
    expect(JSON.stringify(chain)).not.toContain(stored.password_encrypted!);
  });

  it('"direct" is a single Direct item; "global" and no assignment mean no chain', async () => {
    const egress = egressWith({
      servers: [a],
      assignments: [
        { target_type: 'trigger', target_id: 'direct', mode: 'direct', profile_id: null },
        { target_type: 'trigger', target_id: 'global', mode: 'global', profile_id: null },
      ],
    });
    expect(kinds(await egress.chainFor(T1, 'trigger', 'direct'))).toEqual(['direct']);
    expect(await egress.chainFor(T1, 'trigger', 'global')).toBeNull();
    expect(await egress.chainFor(T1, 'trigger', 'unassigned')).toBeNull();
    expect(await egress.chainFor(T1, 'email_config', 'direct')).toBeNull();
  });

  it('a profile that is empty, unknown or has a null id yields no chain', async () => {
    const egress = egressWith({
      servers: [a],
      profiles: { empty: [] },
      assignments: [
        { target_type: 'trigger', target_id: 'e', mode: 'profile', profile_id: 'empty' },
        { target_type: 'trigger', target_id: 'u', mode: 'profile', profile_id: 'unknown' },
        { target_type: 'trigger', target_id: 'n', mode: 'profile', profile_id: null },
      ],
    });
    for (const id of ['e', 'u', 'n']) expect(await egress.chainFor(T1, 'trigger', id)).toBeNull();
  });

  it('silently drops chain items whose proxy no longer exists, keeping the rest', async () => {
    const egress = egressWith({
      servers: [a],
      profiles: { pr: ['ghost', 'a', null], gone: ['ghost'] },
      assignments: [
        { target_type: 'trigger', target_id: 't', mode: 'profile', profile_id: 'pr' },
        { target_type: 'trigger', target_id: 'g', mode: 'profile', profile_id: 'gone' },
      ],
    });
    expect(kinds(await egress.chainFor(T1, 'trigger', 't'))).toEqual(['proxy:a', 'direct']);
    expect(await egress.chainFor(T1, 'trigger', 'g')).toBeNull();
  });

  it('scopeForTarget carries the label, the source and the chain', async () => {
    const egress = egressWith({
      servers: [a],
      profiles: { pr: ['a'] },
      assignments: [
        { target_type: 'email_config', target_id: 'em', mode: 'profile', profile_id: 'pr' },
      ],
    });
    const scope = await egress.scopeForTarget(T1, 'email_config', 'em', 'E-mail');
    expect(scope).toMatchObject({
      tenantId: T1,
      sourceType: 'email_config',
      sourceId: 'em',
      sourceLabel: 'E-mail',
      hops: [],
    });
    expect(kinds(scope.chain)).toEqual(['proxy:a']);
  });
});

describe('scopeForConnection', () => {
  const a = server({ id: 'a', name: 'A' });
  const b = server({ id: 'b', name: 'B' });
  const base: Partial<Tables> = {
    servers: [a, b],
    profiles: { pa: ['a'], pb: ['b', null] },
    connections: [
      { id: 'c-key', provider: 'OpenAI', auth_type: 'api_key', label: 'Default' },
      { id: 'c-sub', provider: 'openai', auth_type: 'subscription', label: 'Plus' },
      { id: 'c-loc', provider: 'custom:abc', auth_type: 'local', label: 'Ollama box' },
    ],
    locals: [{ id: 'custom:abc', local_type: 'Ollama' }],
  };
  const withAssignments = (assignments: Tables['assignments']) =>
    new ProxyEgressService(fakeDs({ [T1]: { ...base, assignments } }).ds);

  it('without a workspace there is no chain', async () => {
    const egress = withAssignments([]);
    expect(await egress.scopeForConnection(null, 'OpenAI', 'c-key')).toEqual({
      tenantId: null,
      sourceType: 'provider',
      sourceId: 'openai',
      sourceLabel: 'openai',
      chain: null,
      hops: [],
    });
    expect((await egress.scopeForConnection(undefined, 'openai', null)).chain).toBeNull();
  });

  it('labels a connection scope "provider / label" and keys it by connection id', async () => {
    const scope = await withAssignments([]).scopeForConnection(T1, 'openai', 'c-key');
    expect(scope).toMatchObject({
      sourceType: 'connection',
      sourceId: 'c-key',
      sourceLabel: 'openai / Default',
      chain: null,
    });
  });

  it('without a connection the scope is the provider itself', async () => {
    const scope = await withAssignments([]).scopeForConnection(T1, 'Anthropic', null);
    expect(scope).toMatchObject({
      sourceType: 'provider',
      sourceId: 'anthropic',
      sourceLabel: 'anthropic',
    });
  });

  it('own assignment > provider default > global', async () => {
    const egress = withAssignments([
      { target_type: 'provider', target_id: 'api_key:openai', mode: 'profile', profile_id: 'pa' },
      { target_type: 'connection', target_id: 'c-key', mode: 'profile', profile_id: 'pb' },
    ]);
    // Own assignment.
    expect(kinds((await egress.scopeForConnection(T1, 'openai', 'c-key')).chain)).toEqual([
      'proxy:b',
      'direct',
    ]);
    // Another connection of the same kind falls back to the provider default... but c-sub is a subscription.
    expect((await egress.scopeForConnection(T1, 'openai', 'c-sub')).chain).toBeNull();
    // A connectionless call with the usage-based default.
    expect(kinds((await egress.scopeForConnection(T1, 'openai', null)).chain)).toEqual(['proxy:a']);
    // Another provider: global (no chain).
    expect((await egress.scopeForConnection(T1, 'anthropic', null)).chain).toBeNull();
  });

  it('the provider default is split by usage-based, subscription and local kinds', async () => {
    const egress = withAssignments([
      { target_type: 'provider', target_id: 'api_key:openai', mode: 'profile', profile_id: 'pa' },
      {
        target_type: 'provider',
        target_id: 'subscription:openai',
        mode: 'profile',
        profile_id: 'pb',
      },
      { target_type: 'provider', target_id: 'local:ollama', mode: 'direct', profile_id: null },
    ]);
    expect(kinds((await egress.scopeForConnection(T1, 'openai', 'c-key')).chain)).toEqual([
      'proxy:a',
    ]);
    expect(kinds((await egress.scopeForConnection(T1, 'openai', 'c-sub')).chain)).toEqual([
      'proxy:b',
      'direct',
    ]);
    expect(kinds((await egress.scopeForConnection(T1, 'custom:abc', 'c-loc')).chain)).toEqual([
      'direct',
    ]);
  });

  it('OAuth flows (no connection) pick the default from the auth kind they pass', async () => {
    const egress = withAssignments([
      { target_type: 'provider', target_id: 'api_key:openai', mode: 'profile', profile_id: 'pa' },
      {
        target_type: 'provider',
        target_id: 'subscription:openai',
        mode: 'profile',
        profile_id: 'pb',
      },
    ]);
    expect(
      kinds((await egress.scopeForConnection(T1, 'openai', null, 'subscription')).chain),
    ).toEqual(['proxy:b', 'direct']);
    expect(kinds((await egress.scopeForConnection(T1, 'openai', null, 'api_key')).chain)).toEqual([
      'proxy:a',
    ]);
    expect(kinds((await egress.scopeForConnection(T1, 'openai', null)).chain)).toEqual(['proxy:a']);
  });

  it('the auth kind of a known connection wins over the one the caller passes', async () => {
    const egress = withAssignments([
      { target_type: 'provider', target_id: 'api_key:openai', mode: 'profile', profile_id: 'pa' },
    ]);
    expect(
      kinds((await egress.scopeForConnection(T1, 'openai', 'c-key', 'subscription')).chain),
    ).toEqual(['proxy:a']);
  });

  it('local runners without a connection use the local default of their name', async () => {
    const egress = withAssignments([
      { target_type: 'provider', target_id: 'local:ollama', mode: 'profile', profile_id: 'pa' },
      { target_type: 'provider', target_id: 'api_key:ollama', mode: 'profile', profile_id: 'pb' },
    ]);
    expect(kinds((await egress.scopeForConnection(T1, 'Ollama', null)).chain)).toEqual(['proxy:a']);
  });

  it('a connection assignment in "global" or "direct" overrides a provider profile', async () => {
    const egress = withAssignments([
      { target_type: 'provider', target_id: 'api_key:openai', mode: 'profile', profile_id: 'pa' },
      { target_type: 'connection', target_id: 'c-key', mode: 'direct', profile_id: null },
    ]);
    expect(kinds((await egress.scopeForConnection(T1, 'openai', 'c-key')).chain)).toEqual([
      'direct',
    ]);
  });

  it('never leaks the chain of one workspace into another', async () => {
    const { ds } = fakeDs({
      [T1]: {
        ...base,
        assignments: [
          {
            target_type: 'provider',
            target_id: 'api_key:openai',
            mode: 'profile',
            profile_id: 'pa',
          },
        ],
      },
      [T2]: { servers: [], profiles: {}, assignments: [], connections: [] },
    });
    const egress = new ProxyEgressService(ds);
    expect(kinds((await egress.scopeForConnection(T1, 'openai', null)).chain)).toEqual(['proxy:a']);
    expect((await egress.scopeForConnection(T2, 'openai', null)).chain).toBeNull();
    // A connection id from another workspace is just unknown here.
    const foreign = await egress.scopeForConnection(T2, 'openai', 'c-key');
    expect(foreign.chain).toBeNull();
    expect(foreign.sourceLabel).toBe('openai');
  });

  it('runForConnection runs the callback inside that scope and restores the previous one', async () => {
    const egress = withAssignments([
      { target_type: 'connection', target_id: 'c-key', mode: 'direct', profile_id: null },
    ]);
    const seen = await egress.runForConnection(T1, 'openai', 'c-key', async () => {
      await new Promise((r) => setImmediate(r));
      return currentOutboundScope();
    });
    expect(seen).toMatchObject({ sourceType: 'connection', sourceId: 'c-key' });
    expect(kinds(seen!.chain)).toEqual(['direct']);
    expect(currentOutboundScope()).toBeNull();
  });

  it('when the first load fails it warns and degrades to no chain instead of throwing', async () => {
    const fake = fakeDs({ [T1]: base });
    fake.state.failing = true;
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const egress = new ProxyEgressService(fake.ds);
    const scope = await egress.scopeForConnection(T1, 'openai', 'c-key');
    expect(scope).toMatchObject({
      tenantId: T1,
      sourceType: 'provider',
      sourceId: 'openai',
      chain: null,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection terminated'));
  });
});

// ---------------------------------------------------------------------------

describe('record (usage rows and proxy logs)', () => {
  function event(
    over: Partial<Omit<HopEvent, 'scope'>> & { scope?: Partial<OutboundScope> } = {},
  ): HopEvent {
    const { scope, ...rest } = over;
    return {
      scope: {
        tenantId: T1,
        sourceType: 'connection',
        sourceId: 'c1',
        sourceLabel: 'openai / Default',
        chain: null,
        hops: [],
        ...scope,
      },
      hop: {
        kind: 'proxy',
        proxy_id: 'p1',
        name: 'A',
        position: 1,
        result: 'ok',
        ms: 10,
        tunnel_ms: 4,
        status: 200,
      },
      proxy: {
        id: 'p1',
        name: 'A',
        scheme: 'http',
        host: 'proxy',
        port: 3128,
        username: 'alice',
        password: SECRET,
        enabled: true,
        connectTimeoutMs: 1000,
        debug: false,
        version: 'v',
      },
      destination: 'api.openai.com:443',
      startedAt: new Date('2026-11-01T10:00:00Z'),
      bytesSent: 11,
      bytesReceived: 22,
      ...rest,
    };
  }

  it('ignores an event that belongs to no workspace', async () => {
    const query = jest.fn();
    await new ProxyEgressService({ query } as never).record(event({ scope: { tenantId: null } }));
    expect(query).not.toHaveBeenCalled();
  });

  it('never stores the proxy credentials in a log row or a usage row', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const egress = new ProxyEgressService({ query } as never);
    await egress.record(
      event({
        hop: {
          kind: 'proxy',
          proxy_id: 'p1',
          name: 'A',
          position: 1,
          result: 'auth_407',
          ms: 3,
          tunnel_ms: null,
          status: 407,
          error: 'Proxy authentication failed',
        },
      }),
    );
    await egress.record(event({ proxy: { ...event().proxy, debug: true } }));
    expect(query.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(query.mock.calls)).not.toContain(SECRET);
  });

  it('a test run is always logged, even when it succeeds and debug is off', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new ProxyEgressService({ query } as never).record(
      event({ scope: { sourceType: 'test', sourceId: null, sourceLabel: 'Test' } }),
    );
    expect(query.mock.calls[0]![0]).toContain('INSERT INTO proxy_logs');
    // source_id is stored as '' in the daily rollup (part of its key).
    expect(query.mock.calls[1]![1]![5]).toBe('');
  });

  it('writes the log row with the tenant, request ids and the error text', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new ProxyEgressService({ query } as never).record(
      event({
        scope: { requestId: 'req-1', agentMessageId: 'msg-1' },
        hop: {
          kind: 'proxy',
          proxy_id: 'p1',
          name: 'A',
          position: 2,
          result: 'refused',
          ms: 5,
          tunnel_ms: null,
          status: null,
          error: 'ECONNREFUSED',
        },
      }),
    );
    const [, params] = query.mock.calls[0]!;
    expect(params[1]).toBe(T1);
    expect(params[2]).toBe('p1');
    expect(params.slice(11, 14)).toEqual([2, 'refused', null]);
    expect(params.slice(14, 19)).toEqual([11, 22, 'req-1', 'msg-1', 'ECONNREFUSED']);
  });

  it('a success without a tunnel time counts no sample, and a failure counts none either', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const egress = new ProxyEgressService({ query } as never);
    await egress.record(
      event({
        hop: {
          kind: 'proxy',
          proxy_id: 'p1',
          name: 'A',
          position: 1,
          result: 'ok',
          ms: 1,
          tunnel_ms: null,
          status: 200,
        },
      }),
    );
    const params = query.mock.calls[0]![1] as unknown[];
    expect(params.slice(9, 12)).toEqual([0, 0, 0]);
  });

  it('puts the day in UTC and counts fallback use for positions past the first', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const egress = new ProxyEgressService({ query } as never);
    await egress.record(
      event({
        startedAt: new Date('2026-11-01T23:59:59Z'),
        hop: {
          kind: 'proxy',
          proxy_id: 'p1',
          name: 'A',
          position: 3,
          result: 'ok',
          ms: 1,
          tunnel_ms: 2,
          status: 200,
        },
      }),
    );
    const params = query.mock.calls[0]![1] as unknown[];
    expect(params[3]).toBe('2026-11-01');
    expect(params[14]).toBe(1);
  });
});

describe('lifecycle', () => {
  it('registers the hop sink on init and removes it (and the agents) on destroy', async () => {
    const sinks: Array<unknown> = [];
    jest.spyOn(outbound, 'setOutboundHopSink').mockImplementation((s) => void sinks.push(s));
    const clear = jest.spyOn(outbound, 'clearProxyAgentCache').mockResolvedValue(undefined);
    const egress = new ProxyEgressService({ query: jest.fn() } as never);
    egress.onModuleInit();
    expect(typeof sinks[0]).toBe('function');
    await egress.onModuleDestroy();
    expect(sinks[1]).toBeNull();
    expect(clear).toHaveBeenCalled();
  });

  it('the sink records the event and only logs when recording fails', async () => {
    let sink: ((e: HopEvent) => void) | null = null;
    jest.spyOn(outbound, 'setOutboundHopSink').mockImplementation((s) => void (sink = s));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const query = jest.fn().mockRejectedValue(new Error('db down'));
    const egress = new ProxyEgressService({ query } as never);
    egress.onModuleInit();
    const ev = {
      scope: {
        tenantId: T1,
        sourceType: 'test',
        sourceId: null,
        sourceLabel: 'Test',
        chain: null,
        hops: [],
      },
      hop: {
        kind: 'proxy',
        proxy_id: 'p1',
        name: 'A',
        position: 1,
        result: 'refused',
        ms: 1,
        tunnel_ms: null,
        status: null,
      },
      proxy: { id: 'p1', name: 'A', debug: false },
      destination: 'x:1',
      startedAt: new Date(),
      bytesSent: 0,
      bytesReceived: 0,
    } as unknown as HopEvent;
    expect(() => sink!(ev)).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(query).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('expireDebug turns expired debug off and invalidates each affected workspace', async () => {
    const query = jest.fn().mockResolvedValue([{ tenant_id: T1 }, { tenant_id: T2 }]);
    const egress = new ProxyEgressService({ query } as never);
    const invalidate = jest.spyOn(egress, 'invalidate');
    await egress.expireDebug();
    const [sql] = query.mock.calls[0]!;
    expect(sql).toContain('debug_enabled = false');
    expect(sql).toContain('debug_until < NOW()');
    expect(sql).toContain('debug_until IS NOT NULL');
    expect(invalidate.mock.calls.map((c) => c[0])).toEqual([T1, T2]);
  });

  it('expireDebug accepts the [rows, count] shape and never throws', async () => {
    const egress = new ProxyEgressService({
      query: jest.fn().mockResolvedValue([[{ tenant_id: T1 }], 1]),
    } as never);
    const invalidate = jest.spyOn(egress, 'invalidate');
    await egress.expireDebug();
    expect(invalidate).toHaveBeenCalledWith(T1);

    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = new ProxyEgressService({
      query: jest.fn().mockRejectedValue(new Error('boom')),
    } as never);
    await expect(failing.expireDebug()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

// ---------------------------------------------------------------------------
// The egress service driving the real outbound helper over loopback proxies.

describe('end to end: assignments -> chain -> outboundFetch (loopback only)', () => {
  interface LoopProxy {
    port: number;
    connects: string[];
    close: () => Promise<void>;
  }
  async function startProxy(opts: { status?: number } = {}): Promise<LoopProxy> {
    const connects: string[] = [];
    const sockets = new Set<Socket>();
    const srv: Server = createServer((_q, res) => res.end());
    srv.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    srv.on('connect', (req: IncomingMessage, client: Socket) => {
      connects.push(req.url ?? '');
      if (opts.status) {
        client.end(`HTTP/1.1 ${opts.status} Nope\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      const [host, port] = (req.url ?? '').split(':');
      const up = connect(Number(port), host, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        up.pipe(client);
        client.pipe(up);
      });
      up.on('error', () => client.destroy());
      client.on('error', () => up.destroy());
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    return {
      port: (srv.address() as AddressInfo).port,
      connects,
      close: () =>
        new Promise((r) => {
          for (const s of sockets) s.destroy();
          srv.close(() => r());
        }),
    };
  }

  let target: Server;
  let url: string;
  const open: LoopProxy[] = [];
  beforeAll(async () => {
    target = createServer((_q, res) => res.end('hello'));
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(target.address() as AddressInfo).port}/x`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => target.close(() => r()));
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((p) => p.close()));
  });
  const proxy = async (opts?: { status?: number }) => {
    const p = await startProxy(opts);
    open.push(p);
    return p;
  };
  async function closedPort(): Promise<number> {
    const s = createServer();
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const { port } = s.address() as AddressInfo;
    await new Promise<void>((r) => s.close(() => r()));
    return port;
  }

  function build(tables: Partial<Tables>) {
    const fake = fakeDs({ [T1]: tables });
    const egress = new ProxyEgressService(fake.ds);
    const events: HopEvent[] = [];
    jest.spyOn(egress, 'record').mockImplementation(async (e) => void events.push(e));
    setOutboundHopSink((e) => void egress.record(e));
    return { egress, events, fake };
  }

  it('goes through the first proxy of the assigned profile', async () => {
    const p = await proxy();
    const { egress, events } = build({
      servers: [server({ id: 'a', port: p.port })],
      profiles: { pr: ['a'] },
      assignments: [
        { target_type: 'provider', target_id: 'api_key:openai', mode: 'profile', profile_id: 'pr' },
      ],
      connections: [{ id: 'c1', provider: 'openai', auth_type: 'api_key', label: 'Default' }],
    });
    const scope = await egress.scopeForConnection(T1, 'openai', 'c1');
    const res = await runWithOutboundScope(scope, () => outboundFetch(url));
    expect(await res.text()).toBe('hello');
    expect(p.connects).toHaveLength(1);
    expect(scope.hops.map((h) => [h.kind, h.result])).toEqual([['proxy', 'ok']]);
    expect(events).toHaveLength(1);
    expect(events[0]!.scope).toMatchObject({
      tenantId: T1,
      sourceType: 'connection',
      sourceId: 'c1',
    });
  });

  it('falls back to Direct when the proxy is down, recording the failed hop', async () => {
    const dead = await closedPort();
    const { egress, events } = build({
      servers: [server({ id: 'a', port: dead })],
      profiles: { pr: ['a', null] },
      assignments: [
        { target_type: 'trigger', target_id: 'hook', mode: 'profile', profile_id: 'pr' },
      ],
    });
    const scope = await egress.scopeForTarget(T1, 'trigger', 'hook', 'Hook');
    const res = await runWithOutboundScope(scope, () => outboundFetch(url));
    expect(res.status).toBe(200);
    expect(scope.hops.map((h) => [h.kind, h.position, h.result])).toEqual([
      ['proxy', 1, 'refused'],
      ['direct', 2, 'ok'],
    ]);
    expect(events.map((e) => [e.hop.result, e.scope.sourceType])).toEqual([['refused', 'trigger']]);
    expect(outbound.summarizeEgress(scope.hops)).toEqual({
      kind: 'direct',
      proxy_id: null,
      name: null,
    });
  });

  it('skips a disabled proxy silently (no log) and uses the next one', async () => {
    const live = await proxy();
    const { egress, events } = build({
      servers: [
        server({ id: 'off', enabled: false, port: 1 }),
        server({ id: 'on', port: live.port }),
      ],
      profiles: { pr: ['off', 'on'] },
      assignments: [
        { target_type: 'trigger', target_id: 'hook', mode: 'profile', profile_id: 'pr' },
      ],
    });
    const scope = await egress.scopeForTarget(T1, 'trigger', 'hook', 'Hook');
    const res = await runWithOutboundScope(scope, () => outboundFetch(url));
    expect(res.status).toBe(200);
    expect(scope.hops.map((h) => h.result)).toEqual(['skipped_disabled', 'ok']);
    expect(live.connects).toHaveLength(1);
    expect(events.every((e) => e.hop.result === 'ok')).toBe(true);
  });

  it('fails closed (never goes direct by itself) when every proxy of the chain is disabled or down', async () => {
    const bad = await proxy({ status: 502 });
    const { egress } = build({
      servers: [
        server({ id: 'off', enabled: false, port: 1 }),
        server({ id: 'bad', port: bad.port }),
      ],
      profiles: { pr: ['off', 'bad'] },
      assignments: [
        { target_type: 'trigger', target_id: 'hook', mode: 'profile', profile_id: 'pr' },
      ],
    });
    const scope = await egress.scopeForTarget(T1, 'trigger', 'hook', 'Hook');
    const err = await runWithOutboundScope(scope, () => outboundFetch(url)).catch((e) => e);
    expect(isProviderProxyFailedError(err)).toBe(true);
    expect(scope.hops.map((h) => h.result)).toEqual(['skipped_disabled', 'connect_status']);
  });

  it('"direct" ignores THINKER_HTTP_PROXY; "global" and unassigned use it', async () => {
    const globalProxy = await proxy();
    setGlobalProxyConfigForTests(
      parseGlobalProxyEnv({
        THINKER_HTTP_PROXY: `http://127.0.0.1:${globalProxy.port}`,
        // Empty the default loopback bypass so 127.0.0.1 targets are proxied.
        THINKER_NO_PROXY: 'unrelated.invalid',
      }),
    );
    // Force the global proxy to apply to the loopback target.
    const cfg = outbound.getGlobalProxyConfig()!;
    cfg.noProxy = { ...cfg.noProxy, matches: (host: string) => host === 'unrelated.invalid' };
    const { egress } = build({
      servers: [],
      assignments: [
        { target_type: 'trigger', target_id: 'direct', mode: 'direct', profile_id: null },
        { target_type: 'trigger', target_id: 'global', mode: 'global', profile_id: null },
      ],
    });
    const viaDirect = await egress.scopeForTarget(T1, 'trigger', 'direct', 'D');
    await runWithOutboundScope(viaDirect, () => outboundFetch(url));
    expect(globalProxy.connects).toHaveLength(0);
    expect(viaDirect.hops.map((h) => h.kind)).toEqual(['direct']);

    for (const id of ['global', 'unassigned']) {
      const scope = await egress.scopeForTarget(T1, 'trigger', id, id);
      await runWithOutboundScope(scope, () => outboundFetch(url));
      expect(scope.hops.map((h) => h.kind)).toEqual(['global']);
    }
    expect(globalProxy.connects).toHaveLength(2);
  });

  it('an unassigned object with no global proxy goes out directly', async () => {
    const { egress } = build({ servers: [], assignments: [] });
    const scope = await egress.scopeForTarget(T1, 'trigger', 'hook', 'Hook');
    const res = await runWithOutboundScope(scope, () => outboundFetch(url));
    expect(res.status).toBe(200);
    expect(scope.hops.map((h) => h.kind)).toEqual(['direct']);
  });

  it('a global proxy that is down fails closed instead of leaking direct', async () => {
    const dead = await closedPort();
    setGlobalProxyConfigForTests(
      parseGlobalProxyEnv({ THINKER_HTTP_PROXY: `http://127.0.0.1:${dead}` }),
    );
    const cfg = outbound.getGlobalProxyConfig()!;
    cfg.noProxy = { ...cfg.noProxy, matches: () => false };
    const { egress } = build({ servers: [], assignments: [] });
    const scope = await egress.scopeForTarget(T1, 'trigger', 'hook', 'Hook');
    const err = await runWithOutboundScope(scope, () => outboundFetch(url)).catch((e) => e);
    expect(isProviderProxyFailedError(err)).toBe(true);
  });
});
