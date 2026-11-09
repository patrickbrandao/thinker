import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { ProxyServersService, validateProxyHost } from './proxy-servers.service';
import { decryptProxyPassword } from './proxy-egress.service';
import {
  clearProxyAgentCache,
  parseGlobalProxyEnv,
  setGlobalProxyConfigForTests,
} from '../common/outbound/outbound-proxy';
import * as ssrf from '../common/utils/ssrf-safe-fetch';

jest.mock('../common/utils/ssrf-safe-fetch', () => ({
  ...jest.requireActual('../common/utils/ssrf-safe-fetch'),
  resolveConnectableAddresses: jest.fn(async () => []),
}));
const resolveMock = ssrf.resolveConnectableAddresses as jest.Mock;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const T1 = 'tenant-1';
const T2 = 'tenant-2';
const SECRET = 'S3cr3t-pa55-never-leaks';

/**
 * In-memory stand-in for the handful of SQL statements the service issues.
 * Every statement is recorded, so specs can assert on the tenant filter and on
 * what reaches the database (encrypted password, never the plain one).
 */
function createFakeDb() {
  const db = {
    servers: [] as Row[],
    profiles: [] as Row[],
    bindings: [] as Row[],
    lines: [] as Row[],
    assignments: [] as Row[],
    connections: [] as Row[],
    customProviders: [] as Row[],
    triggers: [] as Row[],
    emailConfigs: [] as Row[],
    /** Canned results of the aggregate statistics statements. */
    stats7d: [] as Row[],
    statsDaily: [] as Row[],
    statsBySource: [] as Row[],
    statsCodes: [] as Row[],
    logs: [] as Row[],
    calls: [] as Array<[string, unknown[]]>,
  };
  let seq = 0;
  const now = '2026-11-01T00:00:00.000Z';
  const byName = (a: Row, b: Row) => String(a.name).toLowerCase().localeCompare(String(b.name));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = jest.fn(async (rawSql: string, params: any[] = []): Promise<Row[]> => {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    db.calls.push([sql, params]);

    // --- proxy_servers
    if (sql.startsWith('SELECT * FROM proxy_servers WHERE tenant_id = $1')) {
      const [t, id] = params;
      const byId = sql.includes('AND id = $2');
      return db.servers.filter((s) => s.tenant_id === t && (!byId || s.id === id)).sort(byName);
    }
    if (sql.startsWith('SELECT id FROM proxy_servers WHERE tenant_id = $1 AND LOWER(name)')) {
      return db.servers
        .filter(
          (s) => s.tenant_id === params[0] && s.name.toLowerCase() === params[1].toLowerCase(),
        )
        .map((s) => ({ id: s.id }));
    }
    if (sql.startsWith('INSERT INTO proxy_servers')) {
      db.servers.push({
        id: params[0],
        tenant_id: params[1],
        name: params[2],
        scheme: params[3],
        host: params[4],
        port: params[5],
        username: params[6],
        password_encrypted: params[7],
        enabled: params[8],
        connect_timeout_ms: params[9],
        debug_enabled: params[10],
        debug_until: params[11],
        log_retention_days: params[12],
        created_by_user_id: params[13],
        created_at: now,
        updated_at: now,
      });
      return [];
    }
    if (sql.startsWith('UPDATE proxy_servers SET')) {
      const row = db.servers.find((s) => s.id === params[0] && s.tenant_id === params[1]);
      if (row) {
        for (const m of sql.matchAll(/"(\w+)" = \$(\d+)/g)) row[m[1]!] = params[Number(m[2]) - 1];
      }
      return [];
    }
    if (sql.startsWith('DELETE FROM proxy_servers')) {
      db.servers = db.servers.filter((s) => !(s.id === params[0] && s.tenant_id === params[1]));
      db.bindings = db.bindings.filter((b) => b.proxy_id !== params[0]);
      return [];
    }
    if (sql.includes('FROM proxy_usage_daily') && sql.includes('GROUP BY proxy_id')) {
      return db.stats7d;
    }
    if (sql.includes('FROM proxy_usage_daily') && sql.includes('GROUP BY day')) {
      return db.statsDaily;
    }
    if (sql.includes('FROM proxy_usage_daily') && sql.includes('GROUP BY source_type')) {
      return db.statsBySource;
    }
    if (sql.includes('jsonb_each_text')) return db.statsCodes;
    if (sql.includes('FROM proxy_logs')) return db.logs;

    // --- proxy_bindings
    if (sql.includes('FROM proxy_bindings WHERE tenant_id = $1 AND proxy_id IS NOT NULL')) {
      const counts = new Map<string, Set<string>>();
      for (const b of db.bindings.filter((x) => x.tenant_id === params[0] && x.proxy_id)) {
        counts.set(b.proxy_id, (counts.get(b.proxy_id) ?? new Set()).add(b.target_id));
      }
      return [...counts].map(([proxy_id, set]) => ({ proxy_id, count: set.size }));
    }
    const withLine = (b: Row) => {
      const l = db.lines.find(
        (x) => x.tenant_id === b.tenant_id && x.profile_id === b.target_id && x.line === b.line,
      );
      return {
        ...b,
        mode: l?.mode ?? null,
        on_failure: l?.on_failure ?? null,
        no_session: l?.no_session ?? null,
      };
    };
    if (
      sql.includes('FROM proxy_bindings b LEFT JOIN proxy_profile_lines l') &&
      sql.includes('b.target_id IN')
    ) {
      const [t, proxyId] = params;
      const ids = new Set(
        db.bindings
          .filter((b) => b.tenant_id === t && b.target_type === 'profile' && b.proxy_id === proxyId)
          .map((b) => b.target_id),
      );
      return db.bindings
        .filter((b) => b.tenant_id === t && b.target_type === 'profile' && ids.has(b.target_id))
        .sort((a, b) => a.target_id.localeCompare(b.target_id) || a.position - b.position)
        .map(withLine);
    }
    if (sql.includes('FROM proxy_bindings b LEFT JOIN proxy_profile_lines l')) {
      const [t, profileId] = params;
      return db.bindings
        .filter(
          (b) => b.tenant_id === t && b.target_type === 'profile' && b.target_id === profileId,
        )
        .sort((a, b) => a.position - b.position)
        .map(withLine);
    }
    if (
      sql.startsWith(
        'SELECT id, name, enabled FROM proxy_servers WHERE tenant_id = $1 AND id = ANY($2)',
      )
    ) {
      return db.servers.filter((x) => x.tenant_id === params[0] && params[1].includes(x.id));
    }
    if (sql.startsWith('DELETE FROM proxy_bindings')) {
      db.bindings = db.bindings.filter(
        (b) =>
          !(b.tenant_id === params[0] && b.target_type === 'profile' && b.target_id === params[1]),
      );
      return [];
    }
    if (sql.startsWith('DELETE FROM proxy_profile_lines')) {
      db.lines = db.lines.filter((l) => !(l.tenant_id === params[0] && l.profile_id === params[1]));
      return [];
    }
    if (sql.startsWith('INSERT INTO proxy_profile_lines')) {
      const [tenant_id, profile_id, line, mode, on_failure, no_session] = params;
      db.lines.push({ tenant_id, profile_id, line, mode, on_failure, no_session });
      return [];
    }
    if (sql.startsWith('INSERT INTO proxy_bindings')) {
      db.bindings.push({
        tenant_id: params[0],
        target_type: 'profile',
        target_id: params[1],
        position: params[2],
        proxy_id: params[3],
        line: params[4],
      });
      return [];
    }

    // --- proxy_profiles
    if (sql.startsWith('SELECT id, name FROM proxy_profiles WHERE tenant_id = $1')) {
      return db.profiles.filter((p) => p.tenant_id === params[0]);
    }
    if (sql.startsWith('SELECT * FROM proxy_profiles WHERE id = $1 AND tenant_id = $2')) {
      return db.profiles.filter((p) => p.id === params[0] && p.tenant_id === params[1]);
    }
    if (sql.startsWith('SELECT id FROM proxy_profiles WHERE tenant_id = $1 AND LOWER(name)')) {
      const except = sql.includes('AND id <> $3') ? params[2] : null;
      return db.profiles
        .filter(
          (p) =>
            p.tenant_id === params[0] &&
            p.name.toLowerCase() === params[1].toLowerCase() &&
            p.id !== except,
        )
        .map((p) => ({ id: p.id }));
    }
    if (sql.startsWith('SELECT id, name, created_at, updated_at FROM proxy_profiles')) {
      return db.profiles.filter((p) => p.tenant_id === params[0]).sort(byName);
    }
    if (sql.startsWith('INSERT INTO proxy_profiles')) {
      db.profiles.push({
        id: params[0],
        tenant_id: params[1],
        name: params[2],
        created_at: now,
        updated_at: now,
      });
      return [];
    }
    if (sql.startsWith('UPDATE proxy_profiles SET name')) {
      const p = db.profiles.find((x) => x.id === params[1] && x.tenant_id === params[2]);
      if (p) p.name = params[0];
      return [];
    }
    if (sql.startsWith('DELETE FROM proxy_profiles')) {
      db.profiles = db.profiles.filter((p) => !(p.id === params[0] && p.tenant_id === params[1]));
      return [];
    }

    // --- proxy_assignments
    const joinName = (a: Row): Row => ({
      ...a,
      profile_name: db.profiles.find((p) => p.id === a.profile_id)?.name ?? null,
    });
    if (sql.includes("FROM proxy_assignments WHERE tenant_id = $1 AND mode = 'profile'")) {
      const only = sql.includes('AND profile_id = $2') ? params[1] : null;
      return db.assignments
        .filter(
          (a) =>
            a.tenant_id === params[0] && a.mode === 'profile' && (!only || a.profile_id === only),
        )
        .sort(
          (a, b) =>
            a.target_type.localeCompare(b.target_type) || a.target_id.localeCompare(b.target_id),
        );
    }
    if (sql.startsWith('DELETE FROM proxy_assignments WHERE tenant_id = $1 AND profile_id = $2')) {
      db.assignments = db.assignments.filter(
        (a) => !(a.tenant_id === params[0] && a.profile_id === params[1]),
      );
      return [];
    }
    if (sql.startsWith('DELETE FROM proxy_assignments')) {
      db.assignments = db.assignments.filter(
        (a) =>
          !(a.tenant_id === params[0] && a.target_type === params[1] && a.target_id === params[2]),
      );
      return [];
    }
    if (sql.startsWith('SELECT a.mode, a.profile_id, p.name AS profile_name')) {
      return db.assignments
        .filter(
          (a) =>
            a.tenant_id === params[0] && a.target_type === params[1] && a.target_id === params[2],
        )
        .map(joinName);
    }
    if (sql.startsWith('SELECT a.target_type, a.target_id, a.mode')) {
      const type = sql.includes('AND a.target_type = $2') ? params[1] : null;
      return db.assignments
        .filter((a) => a.tenant_id === params[0] && (!type || a.target_type === type))
        .map(joinName)
        .sort(
          (a, b) =>
            a.target_type.localeCompare(b.target_type) || a.target_id.localeCompare(b.target_id),
        );
    }
    if (sql.startsWith('INSERT INTO proxy_assignments')) {
      const [tenant_id, target_type, target_id, mode, profile_id] = params;
      db.assignments = db.assignments.filter(
        (a) =>
          !(
            a.tenant_id === tenant_id &&
            a.target_type === target_type &&
            a.target_id === target_id
          ),
      );
      db.assignments.push({ tenant_id, target_type, target_id, mode, profile_id });
      return [];
    }

    // --- targets
    if (sql.startsWith('SELECT tp.provider, tp.auth_type, cp.local_type')) {
      return db.connections
        .filter((c) => c.id === params[0] && c.tenant_id === params[1])
        .map((c) => ({
          provider: c.provider,
          auth_type: c.auth_type,
          local_type: c.local_type ?? null,
        }));
    }
    if (sql.startsWith('SELECT type FROM triggers WHERE id = $1 AND tenant_id = $2')) {
      return db.triggers.filter((t) => t.id === params[0] && t.tenant_id === params[1]);
    }
    if (sql.startsWith('SELECT id FROM email_provider_configs')) {
      return db.emailConfigs.filter((e) => e.id === params[0] && e.tenant_id === params[1]);
    }
    if (sql.startsWith('SELECT id, provider, label FROM tenant_providers')) {
      return db.connections.filter((c) => c.tenant_id === params[0] && params[1].includes(c.id));
    }
    if (sql.startsWith('SELECT id, name FROM triggers')) {
      return db.triggers.filter((t) => t.tenant_id === params[0] && params[1].includes(t.id));
    }
    if (sql.startsWith('SELECT name FROM custom_providers')) {
      return db.customProviders.filter((c) => c.id === params[0] && c.tenant_id === params[1]);
    }
    if (sql.startsWith("SELECT 'custom:' || id AS id, name, local_type FROM custom_providers")) {
      return db.customProviders
        .filter((c) => c.tenant_id === params[0])
        .map((c) => ({ id: `custom:${c.id}`, name: c.name, local_type: c.local_type ?? null }));
    }
    if (sql.startsWith('SELECT type, config FROM triggers')) {
      return db.triggers.filter((t) => t.id === params[0] && t.tenant_id === params[1]);
    }
    if (sql.startsWith('SELECT provider FROM tenant_providers WHERE id = $1')) {
      return db.connections.filter((c) => c.id === params[0]);
    }
    if (sql.startsWith('SELECT base_url FROM custom_providers')) {
      return db.customProviders.filter((c) => c.id === params[0] && c.tenant_id === params[1]);
    }
    throw new Error(`Unhandled SQL in fake: ${sql}`);
  });

  const transaction = jest.fn(async (fn: (m: unknown) => Promise<unknown>) => {
    const snapshot = JSON.stringify({
      servers: db.servers,
      profiles: db.profiles,
      bindings: db.bindings,
      assignments: db.assignments,
    });
    try {
      return await fn({ query });
    } catch (err) {
      Object.assign(db, JSON.parse(snapshot));
      throw err;
    }
  });

  const addServer = (over: Row = {}): Row => {
    const row = {
      id: `srv-${++seq}`,
      tenant_id: T1,
      name: `Proxy ${seq}`,
      scheme: 'http',
      host: 'proxy.internal',
      port: 3128,
      username: null,
      password_encrypted: null,
      enabled: true,
      connect_timeout_ms: 10000,
      debug_enabled: false,
      debug_until: null,
      log_retention_days: null,
      created_at: now,
      updated_at: now,
      ...over,
    };
    db.servers.push(row);
    return row;
  };
  const addProfileRow = (chain: Array<string | null>, over: Row = {}): Row => {
    const row = {
      id: `prof-${++seq}`,
      tenant_id: T1,
      name: `Profile ${seq}`,
      created_at: now,
      updated_at: now,
      ...over,
    };
    db.profiles.push(row);
    chain.forEach((proxy_id, i) =>
      db.bindings.push({
        tenant_id: row.tenant_id,
        target_type: 'profile',
        target_id: row.id,
        position: i + 1,
        proxy_id,
      }),
    );
    return row;
  };
  const assign = (
    target_type: string,
    target_id: string,
    mode: string,
    profile_id: string | null = null,
    tenant_id = T1,
  ) => db.assignments.push({ tenant_id, target_type, target_id, mode, profile_id });

  return { db, query, transaction, addServer, addProfileRow, assign };
}

function build() {
  const fake = createFakeDb();
  const egress = { invalidate: jest.fn(), record: jest.fn().mockResolvedValue(undefined) };
  const service = new ProxyServersService(
    { query: fake.query, transaction: fake.transaction } as never,
    egress as never,
  );
  return { ...fake, service, egress };
}

const httpError = async (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e) => e,
  );
const messageOf = (err: unknown) =>
  JSON.stringify((err as BadRequestException).getResponse?.() ?? String(err));

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue([]);
});

afterEach(() => {
  setGlobalProxyConfigForTests(null);
});

// ---------------------------------------------------------------------------

describe('validateProxyHost', () => {
  it('normalizes a hostname to lower case and trims it', async () => {
    await expect(validateProxyHost('  Proxy.Corp.Example  ')).resolves.toBe('proxy.corp.example');
  });

  it('accepts IPv4 and IPv6 literals (brackets stripped)', async () => {
    await expect(validateProxyHost('10.0.0.5')).resolves.toBe('10.0.0.5');
    await expect(validateProxyHost('[::1]')).resolves.toBe('::1');
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it.each([
    ['not a string', 42],
    ['empty', '   '],
    ['with a scheme', 'http://proxy.example'],
    ['with a port', 'proxy.example:3128'],
    ['with a path', 'proxy.example/x'],
    ['with spaces', 'my proxy'],
    ['too long', `${'a'.repeat(64)}.example`],
  ])('rejects a host %s', async (_label, value) => {
    expect(await httpError(validateProxyHost(value))).toBeInstanceOf(BadRequestException);
  });

  it.each(['169.254.169.254', 'metadata.google.internal', '[fd00:ec2::254]'])(
    'refuses the cloud metadata endpoint %s',
    async (host) => {
      const err = await httpError(validateProxyHost(host));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(messageOf(err)).toMatch(/metadata/i);
    },
  );

  it('refuses a name that resolves to a metadata address', async () => {
    resolveMock.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'ESSRFBLOCKED' }));
    const err = await httpError(validateProxyHost('sneaky.example'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(messageOf(err)).toMatch(/resolves to a cloud metadata/);
  });

  it('allows a name that does not resolve now (checked again at connect time)', async () => {
    resolveMock.mockRejectedValue(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }));
    await expect(validateProxyHost('later.internal')).resolves.toBe('later.internal');
  });
});

// ---------------------------------------------------------------------------

describe('ProxyServersService.create (validation)', () => {
  const ok = { name: 'Corp', host: 'proxy.corp', port: 3128 };

  it('applies defaults: http, enabled, 10s timeout, no debug, no auth', async () => {
    const { service } = build();
    const created = await service.create(T1, 'u1', ok);
    expect(created).toMatchObject({
      name: 'Corp',
      scheme: 'http',
      host: 'proxy.corp',
      port: 3128,
      username: null,
      has_password: false,
      enabled: true,
      connect_timeout_ms: 10000,
      debug_enabled: false,
      debug_until: null,
      log_retention_days: null,
      status: 'idle',
      binding_count: 0,
    });
  });

  it.each([
    ['missing name', { host: 'h', port: 1 }],
    ['blank name', { name: '   ', host: 'h', port: 1 }],
    ['non-string name', { name: 5, host: 'h', port: 1 }],
    ['name over 100 chars', { name: 'x'.repeat(101), host: 'h', port: 1 }],
    ['unknown scheme', { ...ok, scheme: 'socks5' }],
    ['missing host', { name: 'a', port: 1 }],
    ['port 0', { ...ok, port: 0 }],
    ['port 65536', { ...ok, port: 65536 }],
    ['fractional port', { ...ok, port: 80.5 }],
    ['text port', { ...ok, port: 'http' }],
    ['missing port', { name: 'a', host: 'h' }],
    ['timeout below the minimum', { ...ok, connect_timeout_ms: 499 }],
    ['timeout above the maximum', { ...ok, connect_timeout_ms: 120_001 }],
    ['fractional timeout', { ...ok, connect_timeout_ms: 1000.5 }],
    ['non-boolean enabled', { ...ok, enabled: 'yes' }],
    ['unknown debug duration', { ...ok, debug: '2h' }],
    ['retention as text', { ...ok, log_retention_days: '30' }],
    ['retention zero', { ...ok, log_retention_days: 0 }],
    ['retention fractional', { ...ok, log_retention_days: 1.5 }],
    ['password without a username', { ...ok, password: 'pw' }],
    ['non-string password', { ...ok, username: 'u', password: 1234 }],
    ['password over 1024 chars', { ...ok, username: 'u', password: 'p'.repeat(1025) }],
    ['non-string username', { ...ok, username: 7 }],
    ['username over 255 chars', { ...ok, username: 'u'.repeat(256) }],
  ])('answers 400 for %s and writes nothing', async (_label, body) => {
    const { service, db, egress } = build();
    const err = await httpError(service.create(T1, 'u1', body as never));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(db.servers).toHaveLength(0);
    expect(db.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    expect(egress.invalidate).not.toHaveBeenCalled();
  });

  it('accepts the boundary values', async () => {
    const { service } = build();
    const a = await service.create(T1, null, {
      name: 'n'.repeat(100),
      host: 'h1.example',
      port: 65535,
      connect_timeout_ms: 500,
      scheme: 'https',
      log_retention_days: 1,
    });
    expect(a).toMatchObject({
      port: 65535,
      connect_timeout_ms: 500,
      scheme: 'https',
      log_retention_days: 1,
    });
    const b = await service.create(T1, null, {
      name: 'second',
      host: 'h2.example',
      port: '1',
      connect_timeout_ms: 120_000,
      log_retention_days: null,
    });
    expect(b).toMatchObject({ port: 1, connect_timeout_ms: 120_000, log_retention_days: null });
  });

  it('refuses a duplicate name in the workspace, ignoring case, with 400', async () => {
    const { service, db } = build();
    await service.create(T1, 'u', ok);
    const err = await httpError(service.create(T1, 'u', { ...ok, name: 'CORP' }));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(messageOf(err)).toMatch(/already exists/);
    expect(db.servers).toHaveLength(1);
  });

  it('allows the same name in another workspace', async () => {
    const { service, db } = build();
    await service.create(T1, 'u', ok);
    await expect(service.create(T2, 'u', ok)).resolves.toMatchObject({ name: 'Corp' });
    expect(db.servers.map((s) => s.tenant_id).sort()).toEqual([T1, T2]);
  });

  it('refuses a cloud metadata host', async () => {
    const { service, db } = build();
    const err = await httpError(service.create(T1, 'u', { ...ok, host: '169.254.169.254' }));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(db.servers).toHaveLength(0);
  });

  it('stores the tenant and the creating user, then invalidates the egress cache', async () => {
    const { service, db, egress } = build();
    await service.create(T1, 'user-42', ok);
    expect(db.servers[0]).toMatchObject({ tenant_id: T1, created_by_user_id: 'user-42' });
    expect(egress.invalidate).toHaveBeenCalledWith(T1);
  });

  it.each([
    ['1h', 3_600_000],
    ['24h', 86_400_000],
    ['7d', 7 * 86_400_000],
  ])('debug %s expires after that long', async (debug, ms) => {
    const { service } = build();
    const before = Date.now();
    const created = await service.create(T1, 'u', { ...ok, debug });
    expect(created.debug_enabled).toBe(true);
    const until = new Date(created.debug_until!).getTime();
    expect(until).toBeGreaterThanOrEqual(before + ms - 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + ms + 1000);
  });

  it('debug "forever" and true have no expiry / default to 24h', async () => {
    const { service } = build();
    const forever = await service.create(T1, 'u', { ...ok, debug: 'forever' });
    expect(forever).toMatchObject({ debug_enabled: true, debug_until: null });
    const flag = await service.create(T1, 'u', { ...ok, name: 'flag', debug: true });
    expect(flag.debug_enabled).toBe(true);
    expect(flag.debug_until).not.toBeNull();
    const off = await service.create(T1, 'u', { ...ok, name: 'off', debug: 'off' });
    expect(off).toMatchObject({ debug_enabled: false, debug_until: null });
  });
});

describe('ProxyServersService secrets', () => {
  const body = {
    name: 'Auth',
    host: 'proxy.corp',
    port: 8080,
    username: 'alice',
    password: SECRET,
  };

  it('encrypts the password before it reaches the database', async () => {
    const { service, db } = build();
    await service.create(T1, 'u', body);
    const insert = db.calls.find(([sql]) => sql.startsWith('INSERT INTO proxy_servers'))!;
    expect(JSON.stringify(insert[1])).not.toContain(SECRET);
    const stored = db.servers[0]!.password_encrypted as string;
    expect(stored).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(decryptProxyPassword(stored)).toBe(SECRET);
    // Nothing else in any statement carries the plain text either.
    expect(JSON.stringify(db.calls)).not.toContain(SECRET);
  });

  it('never returns the password or its ciphertext from create, get, list or update', async () => {
    const { service, db } = build();
    const created = await service.create(T1, 'u', body);
    const ciphertext = db.servers[0]!.password_encrypted as string;
    const updated = await service.update(T1, created.id, {
      name: 'Auth 2',
      password: SECRET + '2',
    });
    const got = await service.get(T1, created.id);
    const listed = await service.list(T1);
    for (const out of [created, updated, got, listed]) {
      const json = JSON.stringify(out);
      expect(json).not.toContain(SECRET);
      expect(json).not.toContain(ciphertext);
      expect(json).not.toContain(db.servers[0]!.password_encrypted);
      expect(json).not.toMatch(/password_encrypted|"password"/);
    }
    expect(created).toMatchObject({ username: 'alice', has_password: true });
    expect(listed.proxies[0]).toMatchObject({ has_password: true });
  });

  it('uses a different ciphertext per encryption (random salt and IV)', async () => {
    const { service, db } = build();
    await service.create(T1, 'u', body);
    await service.create(T1, 'u', { ...body, name: 'Auth B' });
    expect(db.servers[0]!.password_encrypted).not.toBe(db.servers[1]!.password_encrypted);
  });

  it('keeps the stored password when an edit sends none, an empty one or null', async () => {
    const { service, db } = build();
    const { id } = await service.create(T1, 'u', body);
    const before = db.servers[0]!.password_encrypted;
    await service.update(T1, id, { port: 9090 });
    await service.update(T1, id, { password: '' });
    await service.update(T1, id, { password: null });
    expect(db.servers[0]!.password_encrypted).toBe(before);
    expect(db.servers[0]!.port).toBe(9090);
    const updates = db.calls.filter(([sql]) => sql.startsWith('UPDATE proxy_servers'));
    expect(updates.every(([sql]) => !sql.includes('password_encrypted'))).toBe(true);
  });

  it('replaces the password when a new one is sent', async () => {
    const { service, db } = build();
    const { id } = await service.create(T1, 'u', body);
    const before = db.servers[0]!.password_encrypted;
    await service.update(T1, id, { password: 'brand-new-password' });
    expect(db.servers[0]!.password_encrypted).not.toBe(before);
    expect(decryptProxyPassword(db.servers[0]!.password_encrypted)).toBe('brand-new-password');
  });

  it('auth "none" clears the username and the password', async () => {
    const { service, db } = build();
    const { id } = await service.create(T1, 'u', body);
    const out = await service.update(T1, id, { auth: 'none' });
    expect(db.servers[0]).toMatchObject({ username: null, password_encrypted: null });
    expect(out).toMatchObject({ username: null, has_password: false });
  });

  it('auth "none" wins over a password sent in the same request', async () => {
    const { service, db } = build();
    const created = await service.create(T1, 'u', {
      name: 'N',
      host: 'h.example',
      port: 1,
      auth: 'none',
      username: 'x',
      password: 'y',
    });
    expect(created).toMatchObject({ username: null, has_password: false });
    expect(db.servers[0]!.password_encrypted).toBeNull();
  });

  it('removing the username drops the now useless stored password', async () => {
    const { service, db } = build();
    const { id } = await service.create(T1, 'u', body);
    await service.update(T1, id, { username: '' });
    expect(db.servers[0]).toMatchObject({ username: null, password_encrypted: null });
  });

  it('refuses to set a password on an edit that leaves no username', async () => {
    const { service, db } = build();
    const { id } = await service.create(T1, 'u', { name: 'Open', host: 'h.example', port: 1 });
    const err = await httpError(service.update(T1, id, { password: 'pw' }));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(db.servers[0]!.password_encrypted).toBeNull();
  });

  it('trims the username', async () => {
    const { service } = build();
    const created = await service.create(T1, 'u', { ...body, username: '  alice  ' });
    expect(created.username).toBe('alice');
  });

  it('decryptProxyPassword answers null for nothing and for an unreadable value', () => {
    expect(decryptProxyPassword(null)).toBeNull();
    expect(decryptProxyPassword('')).toBeNull();
    expect(decryptProxyPassword('not-encrypted')).toBeNull();
  });
});

describe('ProxyServersService.update / get / list (tenant scoping)', () => {
  it('answers 404 for another workspace and for no workspace, never touching the row', async () => {
    const { service, db, addServer } = build();
    const row = addServer({ tenant_id: T2, name: 'Theirs' });
    for (const call of [
      () => service.get(T1, row.id),
      () => service.update(T1, row.id, { name: 'mine now' }),
      () => service.remove(T1, row.id, 'remove'),
      () => service.test(T1, row.id, { url: 'http://x.example' }),
      () => service.logs(T1, row.id, {}),
      () => service.stats(T1, row.id),
      () => service.get(null, row.id),
      () => service.stats(null, row.id),
    ]) {
      const err = await httpError(call());
      expect(err).toBeInstanceOf(NotFoundException);
    }
    expect(db.servers).toHaveLength(1);
    expect(db.servers[0]!.name).toBe('Theirs');
    expect(db.calls.some(([sql]) => /^(UPDATE|DELETE)/.test(sql))).toBe(false);
  });

  it('scopes every select by the tenant id parameter', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    await service.get(T1, row.id);
    await service.list(T1);
    for (const [sql, params] of db.calls) {
      if (/FROM (proxy_servers|proxy_usage_daily|proxy_bindings)/.test(sql)) {
        expect(params[0]).toBe(T1);
      }
    }
  });

  it('list shows only the caller workspace, ordered by name, with an empty list for none', async () => {
    const { service, addServer } = build();
    addServer({ name: 'beta' });
    addServer({ name: 'Alpha' });
    addServer({ name: 'foreign', tenant_id: T2 });
    const listed = await service.list(T1);
    expect(listed.proxies.map((p) => p.name)).toEqual(['Alpha', 'beta']);
    expect(await service.list(null)).toEqual({ proxies: [], global: null });
  });

  it('shows the global proxy of the environment without its credentials', async () => {
    setGlobalProxyConfigForTests(
      parseGlobalProxyEnv({
        THINKER_HTTP_PROXY: `http://bob:${SECRET}@gw.corp:3128`,
        THINKER_NO_PROXY: 'internal.example',
      }),
    );
    const { service } = build();
    const listed = await service.list(T1);
    expect(listed.global).toMatchObject({ url: 'http://gw.corp:3128' });
    expect(listed.global!.no_proxy).toContain('internal.example');
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(JSON.stringify(listed)).not.toContain('bob');
    const noOrg = await service.list(null);
    expect(noOrg.global).toMatchObject({ url: 'http://gw.corp:3128' });
  });

  it('partial update changes only the sent fields and bumps updated_at', async () => {
    const { service, db, addServer, egress } = build();
    const row = addServer({ name: 'Keep', port: 3128, connect_timeout_ms: 7000 });
    await service.update(T1, row.id, { port: 8080 });
    expect(db.servers[0]).toMatchObject({ name: 'Keep', port: 8080, connect_timeout_ms: 7000 });
    const [sql] = db.calls.find(([s]) => s.startsWith('UPDATE proxy_servers'))!;
    expect(sql).toContain('updated_at = NOW()');
    expect(sql).toMatch(/WHERE id = \$1 AND tenant_id = \$2$/);
    expect(egress.invalidate).toHaveBeenCalledWith(T1);
  });

  it('renaming to its own name (any case) is allowed, to another proxy name is not', async () => {
    const { service, addServer } = build();
    const a = addServer({ name: 'Alpha' });
    addServer({ name: 'Beta' });
    await expect(service.update(T1, a.id, { name: 'ALPHA' })).resolves.toMatchObject({
      name: 'ALPHA',
    });
    const err = await httpError(service.update(T1, a.id, { name: 'beta' }));
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('can disable and re-enable a proxy, which shows in its status', async () => {
    const { service, addServer } = build();
    const row = addServer();
    await expect(service.update(T1, row.id, { enabled: false })).resolves.toMatchObject({
      enabled: false,
      status: 'disabled',
    });
    await expect(service.update(T1, row.id, { enabled: true })).resolves.toMatchObject({
      enabled: true,
      status: 'idle',
    });
  });

  it('debug can be switched off again', async () => {
    const { service, addServer } = build();
    const row = addServer({ debug_enabled: true, debug_until: null });
    const out = await service.update(T1, row.id, { debug: 'off' });
    expect(out).toMatchObject({ debug_enabled: false, debug_until: null });
  });

  it('reports an expired debug window as off', async () => {
    const { service, addServer } = build();
    const row = addServer({
      debug_enabled: true,
      debug_until: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await service.get(T1, row.id)).debug_enabled).toBe(false);
  });
});

describe('ProxyServersService status and 7-day statistics', () => {
  const stat = (over: Row) => ({
    connections: '0',
    successes: '0',
    failures: '0',
    tunnel_sum: '0',
    tunnel_samples: '0',
    bytes_sent: '0',
    bytes_received: '0',
    ...over,
  });

  it('derives idle, ok, degraded and failing, and disabled over all of them', async () => {
    const { service, db, addServer } = build();
    const idle = addServer({ name: 'a-idle' });
    const ok = addServer({ name: 'b-ok' });
    const degraded = addServer({ name: 'c-degraded' });
    const failing = addServer({ name: 'd-failing' });
    const off = addServer({ name: 'e-off', enabled: false });
    db.stats7d = [
      stat({ proxy_id: ok.id, connections: '4', successes: '4' }),
      stat({ proxy_id: degraded.id, connections: '4', successes: '3', failures: '1' }),
      stat({ proxy_id: failing.id, connections: '2', failures: '2' }),
      stat({ proxy_id: off.id, connections: '9', successes: '9' }),
    ];
    const status = Object.fromEntries(
      (await service.list(T1)).proxies.map((p) => [p.id, p.status]),
    );
    expect(status).toEqual({
      [idle.id]: 'idle',
      [ok.id]: 'ok',
      [degraded.id]: 'degraded',
      [failing.id]: 'failing',
      [off.id]: 'disabled',
    });
  });

  it('turns the numeric strings of the database into numbers and averages the tunnel time', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    db.stats7d = [
      stat({
        proxy_id: row.id,
        connections: '3',
        successes: '2',
        failures: '1',
        tunnel_sum: '100',
        tunnel_samples: '3',
        bytes_sent: '12345678901',
        bytes_received: '5',
      }),
    ];
    const [view] = (await service.list(T1)).proxies;
    expect(view!.stats_7d).toEqual({
      connections: 3,
      successes: 2,
      failures: 1,
      avg_tunnel_ms: 33,
      bytes_sent: 12345678901,
      bytes_received: 5,
    });
  });

  it('has no average without tunnel samples, and no stats at all without usage', async () => {
    const { service, db, addServer } = build();
    const used = addServer({ name: 'used' });
    addServer({ name: 'unused' });
    db.stats7d = [stat({ proxy_id: used.id, connections: '1', failures: '1' })];
    const byName = Object.fromEntries((await service.list(T1)).proxies.map((p) => [p.name, p]));
    expect(byName['used']!.stats_7d!.avg_tunnel_ms).toBeNull();
    expect(byName['unused']!.stats_7d).toBeNull();
  });

  it('counts each profile once per proxy in binding_count', async () => {
    const { service, addServer, addProfileRow } = build();
    const a = addServer({ name: 'a' });
    const b = addServer({ name: 'b' });
    addProfileRow([a.id, b.id]);
    addProfileRow([a.id]);
    const counts = Object.fromEntries(
      (await service.list(T1)).proxies.map((p) => [p.name, p.binding_count]),
    );
    expect(counts).toEqual({ a: 2, b: 1 });
  });
});

describe('ProxyServersService.remove', () => {
  it('deletes an unused proxy straight away', async () => {
    const { service, db, addServer, egress } = build();
    const row = addServer();
    await expect(service.remove(T1, row.id)).resolves.toEqual({ deleted: true, affected: 0 });
    expect(db.servers).toHaveLength(0);
    expect(egress.invalidate).toHaveBeenCalledWith(T1);
  });

  it('409 "proxy_in_use" names the profile, even if the mode is unknown', async () => {
    const { service, db, addServer, addProfileRow } = build();
    const row = addServer();
    const profile = addProfileRow([row.id], { name: 'Office' });
    for (const mode of [undefined, '', 'purge']) {
      const err = await httpError(service.remove(T1, row.id, mode));
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as Row;
      expect(body).toMatchObject({ error: 'proxy_in_use', statusCode: 409 });
      expect(body.bindings).toEqual([
        { target_type: 'profile', target_id: profile.id, label: 'Office', loses_proxy: true },
      ]);
    }
    expect(db.servers).toHaveLength(1);
  });

  it('"remove" drops the proxy from chains and leaves the profile row, minus the lost proxy', async () => {
    const { service, db, addServer, addProfileRow } = build();
    const a = addServer({ name: 'a' });
    const b = addServer({ name: 'b' });
    const profile = addProfileRow([a.id, null, b.id]);
    await expect(service.remove(T1, a.id, 'remove')).resolves.toEqual({
      deleted: true,
      affected: 1,
    });
    const chain = db.bindings.filter((x) => x.target_id === profile.id).map((x) => x.proxy_id);
    // "direct" may not lead a chain: it moves behind the next proxy.
    expect(chain).toEqual([b.id, null]);
  });

  it('"remove" on the only proxy of a profile empties the chain', async () => {
    const { service, db, addServer, addProfileRow } = build();
    const a = addServer();
    const profile = addProfileRow([a.id, null]);
    await service.remove(T1, a.id, 'remove');
    expect(db.bindings.filter((x) => x.target_id === profile.id)).toEqual([]);
    expect(db.servers).toHaveLength(0);
  });

  it('"replace" swaps the proxy in place', async () => {
    const { service, db, addServer, addProfileRow } = build();
    const a = addServer({ name: 'a' });
    const b = addServer({ name: 'b' });
    const profile = addProfileRow([a.id, null]);
    await service.remove(T1, a.id, 'replace', b.id);
    expect(db.bindings.filter((x) => x.target_id === profile.id).map((x) => x.proxy_id)).toEqual([
      b.id,
      null,
    ]);
    expect(db.servers.map((s) => s.id)).toEqual([b.id]);
  });

  it('"replace" needs another proxy of the same workspace', async () => {
    const { service, db, addServer, addProfileRow } = build();
    const a = addServer({ name: 'a' });
    const foreign = addServer({ name: 'f', tenant_id: T2 });
    addProfileRow([a.id]);
    expect(await httpError(service.remove(T1, a.id, 'replace'))).toBeInstanceOf(
      BadRequestException,
    );
    expect(await httpError(service.remove(T1, a.id, 'replace', a.id))).toBeInstanceOf(
      BadRequestException,
    );
    expect(await httpError(service.remove(T1, a.id, 'replace', 'missing'))).toBeInstanceOf(
      NotFoundException,
    );
    expect(await httpError(service.remove(T1, a.id, 'replace', foreign.id))).toBeInstanceOf(
      NotFoundException,
    );
    expect(db.servers).toHaveLength(2);
    expect(db.bindings).toHaveLength(1);
  });

  it('rolls the whole removal back when a statement fails', async () => {
    const { service, db, query, addServer, addProfileRow } = build();
    const a = addServer({ name: 'a' });
    const b = addServer({ name: 'b' });
    const profile = addProfileRow([a.id, b.id]);
    const real = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('DELETE FROM proxy_servers')) throw new Error('db down');
      return real(sql, params);
    });
    await expect(service.remove(T1, a.id, 'remove')).rejects.toThrow('db down');
    expect(db.bindings.filter((x) => x.target_id === profile.id).map((x) => x.proxy_id)).toEqual([
      a.id,
      b.id,
    ]);
    expect(db.servers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe('ProxyServersService profiles', () => {
  function withServers() {
    const ctx = build();
    const a = ctx.addServer({ name: 'a' });
    const b = ctx.addServer({ name: 'b', enabled: false });
    const foreign = ctx.addServer({ name: 'foreign', tenant_id: T2 });
    return { ...ctx, a, b, foreign };
  }

  it('creates a profile and shows the chain with a Direct item and a disabled server', async () => {
    const { service, a, b, egress } = withServers();
    const created = await service.createProfile(T1, {
      name: 'Office',
      chain: [a.id, b.id, 'direct'],
    });
    expect(created).toMatchObject({ name: 'Office', used_by: [] });
    expect(created!.chain).toEqual([
      { kind: 'proxy', proxy_id: a.id, name: 'a', enabled: true, line: 1, mode: 'proxy' },
      { kind: 'proxy', proxy_id: b.id, name: 'b', enabled: false, line: 2, mode: 'proxy' },
      { kind: 'direct', proxy_id: null, name: 'Direct', enabled: true, line: 3, mode: 'direct' },
    ]);
    expect(egress.invalidate).toHaveBeenCalledWith(T1);
  });

  it('stores balanced lines with their options and shows them grouped', async () => {
    const { service, db, a, b, addServer } = withServers();
    const c = addServer({ name: 'c' });
    const created = await service.createProfile(T1, {
      name: 'Balance-First',
      lines: [
        { mode: 'affinity', proxies: [a.id, c.id], no_session: 'agent' },
        { mode: 'request', proxies: [b.id] },
        { mode: 'direct' },
      ],
    });
    expect(db.bindings.map((x) => [x.line, x.position, x.proxy_id])).toEqual([
      [1, 1, a.id],
      [1, 2, c.id],
      [2, 3, b.id],
      [3, 4, null],
    ]);
    expect(created!.lines.map((l) => [l.line, l.mode, l.no_session, l.members.length])).toEqual([
      [1, 'affinity', 'agent', 2],
      [2, 'proxy', 'request', 1],
      [3, 'direct', 'request', 1],
    ]);
  });

  it('stores Direct as a NULL proxy at its position', async () => {
    const { service, db, a, b } = withServers();
    await service.createProfile(T1, { name: 'P', chain: [a.id, 'direct', b.id] });
    expect(db.bindings.map((x) => [x.position, x.proxy_id])).toEqual([
      [1, a.id],
      [2, null],
      [3, b.id],
    ]);
  });

  it.each([
    ['no body fields', {}],
    ['blank name', { name: ' ', chain: ['@a'] }],
    ['name over 100 chars', { name: 'n'.repeat(101), chain: ['@a'] }],
    ['an empty chain', { name: 'P', chain: [] }],
    ['no chain', { name: 'P' }],
    ['a chain that is not an array', { name: 'P', chain: '@a' }],
    ['Direct only', { name: 'P', chain: ['direct'] }],
    ['Direct first', { name: 'P', chain: ['direct', '@a'] }],
    ['Direct twice', { name: 'P', chain: ['@a', 'direct', 'direct'] }],
    ['a repeated proxy', { name: 'P', chain: ['@a', '@a'] }],
    ['an unknown proxy', { name: 'P', chain: ['@a', 'ghost'] }],
    ['a non-string item', { name: 'P', chain: ['@a', 7] }],
    ['too many items', { name: 'P', chain: Array.from({ length: 7 }, (_, i) => `@s${i}`) }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const { service, db, a } = withServers();
    const resolved = JSON.parse(JSON.stringify(body).replaceAll('"@a"', JSON.stringify(a.id)));
    const err = await httpError(service.createProfile(T1, resolved));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(db.profiles).toHaveLength(0);
    expect(db.bindings).toHaveLength(0);
  });

  it('refuses a proxy of another workspace as if it did not exist', async () => {
    const { service, db, foreign } = withServers();
    const err = await httpError(service.createProfile(T1, { name: 'P', chain: [foreign.id] }));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(messageOf(err)).toMatch(/Unknown proxy/);
    expect(db.profiles).toHaveLength(0);
  });

  it('accepts a chain of exactly the maximum length', async () => {
    const ctx = build();
    const ids = Array.from({ length: 6 }, (_, i) => ctx.addServer({ name: `s${i}` }).id);
    const created = await ctx.service.createProfile(T1, { name: 'Max', chain: ids });
    expect(created!.chain).toHaveLength(6);
  });

  it('refuses a duplicate profile name (any case) with 409, but not in another workspace', async () => {
    const { service, a, addServer } = withServers();
    await service.createProfile(T1, { name: 'Office', chain: [a.id] });
    const dup = await httpError(service.createProfile(T1, { name: 'OFFICE', chain: [a.id] }));
    expect(dup).toBeInstanceOf(ConflictException);
    const other = addServer({ tenant_id: T2, name: 'o' });
    await expect(
      service.createProfile(T2, { name: 'Office', chain: [other.id] }),
    ).resolves.toBeDefined();
  });

  it('lists only the workspace profiles, with the targets that use each one', async () => {
    const { service, a, assign, addProfileRow, db } = withServers();
    const mine = addProfileRow([a.id], { name: 'Mine' });
    addProfileRow([], { name: 'Theirs', tenant_id: T2 });
    db.connections.push({
      id: 'c1',
      tenant_id: T1,
      provider: 'openai',
      auth_type: 'api_key',
      label: 'Default',
    });
    assign('connection', 'c1', 'profile', mine.id);
    assign('provider', 'api_key:openai', 'profile', mine.id);
    const { profiles } = await service.listProfiles(T1);
    expect(profiles.map((p) => p.name)).toEqual(['Mine']);
    expect(profiles[0]!.used_by).toEqual([
      {
        profile_id: mine.id,
        target_type: 'connection',
        target_id: 'c1',
        label: 'openai / Default',
      },
      {
        profile_id: mine.id,
        target_type: 'provider',
        target_id: 'api_key:openai',
        label: 'openai (usage-based)',
      },
    ]);
    expect(await service.listProfiles(null)).toEqual({ profiles: [] });
  });

  it('updates the name and the chain in one go', async () => {
    const { service, db, a, b, addProfileRow, egress } = withServers();
    const p = addProfileRow([a.id], { name: 'Old' });
    const updated = await service.updateProfile(T1, p.id, { name: 'New', chain: [b.id, 'direct'] });
    expect(updated).toMatchObject({ name: 'New' });
    expect(db.bindings.map((x) => x.proxy_id)).toEqual([b.id, null]);
    expect(egress.invalidate).toHaveBeenCalledWith(T1);
  });

  it('keeps the old chain when the update is invalid', async () => {
    const { service, db, a, addProfileRow } = withServers();
    const p = addProfileRow([a.id], { name: 'Old' });
    expect(
      await httpError(service.updateProfile(T1, p.id, { name: 'New', chain: ['ghost'] })),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await httpError(service.updateProfile(T1, p.id, { name: 'New', chain: [] })),
    ).toBeInstanceOf(BadRequestException);
    expect(db.profiles[0]!.name).toBe('Old');
    expect(db.bindings.map((x) => x.proxy_id)).toEqual([a.id]);
  });

  it('may keep its own name on update but not take another profile name', async () => {
    const { service, a, addProfileRow } = withServers();
    const p = addProfileRow([a.id], { name: 'One' });
    addProfileRow([a.id], { name: 'Two' });
    await expect(
      service.updateProfile(T1, p.id, { name: 'one', chain: [a.id] }),
    ).resolves.toMatchObject({ name: 'one' });
    expect(
      await httpError(service.updateProfile(T1, p.id, { name: 'TWO', chain: [a.id] })),
    ).toBeInstanceOf(ConflictException);
  });

  it('answers 404 to update or delete a profile of another workspace', async () => {
    const { service, db, a, addProfileRow } = withServers();
    const theirs = addProfileRow([], { tenant_id: T2, name: 'Theirs' });
    expect(
      await httpError(service.updateProfile(T1, theirs.id, { name: 'x', chain: [a.id] })),
    ).toBeInstanceOf(NotFoundException);
    expect(await httpError(service.removeProfile(T1, theirs.id, 'remove'))).toBeInstanceOf(
      NotFoundException,
    );
    expect(await httpError(service.updateProfile(null, theirs.id, { name: 'x' }))).toBeInstanceOf(
      NotFoundException,
    );
    expect(db.profiles).toHaveLength(1);
  });

  it('delete: 409 "profile_in_use" lists who uses it unless mode=remove', async () => {
    const { service, db, a, assign, addProfileRow } = withServers();
    const p = addProfileRow([a.id], { name: 'Busy' });
    db.connections.push({
      id: 'c1',
      tenant_id: T1,
      provider: 'openai',
      auth_type: 'api_key',
      label: 'Default',
    });
    assign('connection', 'c1', 'profile', p.id);
    const err = await httpError(service.removeProfile(T1, p.id));
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      error: 'profile_in_use',
      used_by: [{ target_type: 'connection', target_id: 'c1', label: 'openai / Default' }],
    });
    expect(db.profiles).toHaveLength(1);
    expect(await httpError(service.removeProfile(T1, p.id, 'replace'))).toBeInstanceOf(
      ConflictException,
    );
  });

  it('delete with mode=remove sends the users back to inherit and removes the chain', async () => {
    const { service, db, a, assign, addProfileRow } = withServers();
    const p = addProfileRow([a.id, null]);
    assign('connection', 'c1', 'profile', p.id);
    assign('provider', 'api_key:openai', 'direct');
    await expect(service.removeProfile(T1, p.id, 'remove')).resolves.toEqual({
      deleted: true,
      affected: 1,
    });
    expect(db.profiles).toHaveLength(0);
    expect(db.bindings).toHaveLength(0);
    // The unrelated assignment stays; the proxy server itself stays.
    expect(db.assignments).toEqual([
      expect.objectContaining({ target_id: 'api_key:openai', mode: 'direct' }),
    ]);
    expect(db.servers.some((s) => s.id === a.id)).toBe(true);
  });

  it('delete of an unused profile needs no mode', async () => {
    const { service, a, addProfileRow, db } = withServers();
    const p = addProfileRow([a.id]);
    await expect(service.removeProfile(T1, p.id)).resolves.toEqual({ deleted: true, affected: 0 });
    expect(db.profiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('ProxyServersService assignments', () => {
  function setup() {
    const ctx = build();
    const a = ctx.addServer({ name: 'a' });
    const b = ctx.addServer({ name: 'b', enabled: false });
    const profile = ctx.addProfileRow([a.id, b.id, null], { name: 'Office' });
    const other = ctx.addProfileRow([a.id], { name: 'Other' });
    ctx.db.connections.push(
      { id: 'c-key', tenant_id: T1, provider: 'openai', auth_type: 'api_key', label: 'Default' },
      { id: 'c-sub', tenant_id: T1, provider: 'openai', auth_type: 'subscription', label: 'Plus' },
      { id: 'c-foreign', tenant_id: T2, provider: 'openai', auth_type: 'api_key', label: 'X' },
      {
        id: 'c-local',
        tenant_id: T1,
        provider: 'custom:abc',
        auth_type: 'local',
        label: 'Ollama',
        local_type: 'ollama',
      },
    );
    ctx.db.customProviders.push({
      id: 'abc',
      tenant_id: T1,
      name: 'My Ollama',
      local_type: 'ollama',
      base_url: 'http://10.0.0.9:11434',
    });
    return { ...ctx, a, b, profile, other };
  }

  it('answers 404 to an unknown target type, including prototype keys', async () => {
    const { service } = setup();
    for (const type of ['nope', 'PROVIDER', '__proto__', 'constructor', '']) {
      expect(await httpError(service.getAssignment(T1, type, 'x'))).toBeInstanceOf(
        NotFoundException,
      );
      expect(
        await httpError(service.setAssignment(T1, type, 'x', { mode: 'direct' })),
      ).toBeInstanceOf(NotFoundException);
    }
  });

  it('answers 404 with no workspace', async () => {
    const { service } = setup();
    expect(
      await httpError(service.getAssignment(null, 'provider', 'api_key:openai')),
    ).toBeInstanceOf(NotFoundException);
    expect(
      await httpError(
        service.setAssignment(null, 'provider', 'api_key:openai', { mode: 'direct' }),
      ),
    ).toBeInstanceOf(NotFoundException);
    expect(await service.listAssignments(null)).toEqual({ assignments: [], custom_providers: [] });
  });

  describe('resolution order: own assignment > provider default > global', () => {
    it('with nothing configured a connection inherits the global path (no proxy)', async () => {
      const { service } = setup();
      const out = await service.getAssignment(T1, 'connection', 'c-key');
      expect(out).toMatchObject({
        mode: 'inherit',
        profile_id: null,
        inherited: { target_id: 'api_key:openai', mode: 'global', profile_id: null },
        effective: { source: 'global', mode: 'global', chain: [], global: null },
      });
    });

    it('reports the environment global proxy as the effective path', async () => {
      setGlobalProxyConfigForTests(
        parseGlobalProxyEnv({ THINKER_HTTP_PROXY: 'http://u:p@gw.corp:3128' }),
      );
      const { service } = setup();
      const out = await service.getAssignment(T1, 'connection', 'c-key');
      expect(out.effective).toMatchObject({
        source: 'global',
        mode: 'global',
        global: 'http://gw.corp:3128',
      });
      expect(JSON.stringify(out)).not.toContain('u:p');
    });

    it('the provider default applies to the connection of that kind only', async () => {
      const { service, assign, profile } = setup();
      assign('provider', 'api_key:openai', 'profile', profile.id);
      const key = await service.getAssignment(T1, 'connection', 'c-key');
      expect(key.mode).toBe('inherit');
      expect(key.inherited).toMatchObject({
        target_id: 'api_key:openai',
        mode: 'profile',
        profile_id: profile.id,
        profile_name: 'Office',
      });
      expect(key.effective).toMatchObject({
        source: 'provider',
        mode: 'profile',
        profile_id: profile.id,
        profile_name: 'Office',
      });
      // A subscription connection of the same provider has its own default.
      const sub = await service.getAssignment(T1, 'connection', 'c-sub');
      expect(sub.inherited!.target_id).toBe('subscription:openai');
      expect(sub.effective).toMatchObject({ source: 'global', mode: 'global' });
    });

    it('its own assignment beats the provider default', async () => {
      const { service, assign, profile, other } = setup();
      assign('provider', 'api_key:openai', 'profile', profile.id);
      assign('connection', 'c-key', 'profile', other.id);
      const out = await service.getAssignment(T1, 'connection', 'c-key');
      expect(out).toMatchObject({ mode: 'profile', profile_id: other.id });
      expect(out.effective).toMatchObject({
        source: 'connection',
        profile_id: other.id,
        profile_name: 'Other',
      });
    });

    it('its own "direct" beats a provider profile, and its own "global" ignores it too', async () => {
      const { service, db, assign, profile } = setup();
      assign('provider', 'api_key:openai', 'profile', profile.id);
      assign('connection', 'c-key', 'direct');
      expect((await service.getAssignment(T1, 'connection', 'c-key')).effective).toEqual({
        source: 'connection',
        mode: 'direct',
        chain: [],
      });
      db.assignments = db.assignments.filter((a) => a.target_type !== 'connection');
      assign('connection', 'c-key', 'global');
      expect((await service.getAssignment(T1, 'connection', 'c-key')).effective).toMatchObject({
        source: 'connection',
        mode: 'global',
        chain: [],
      });
    });

    it('a provider default of "direct" is inherited as direct', async () => {
      const { service, assign } = setup();
      assign('provider', 'subscription:openai', 'direct');
      expect((await service.getAssignment(T1, 'connection', 'c-sub')).effective).toEqual({
        source: 'provider',
        mode: 'direct',
        chain: [],
      });
    });

    it('local servers use the default of their type', async () => {
      const { service, assign, profile } = setup();
      assign('provider', 'local:ollama', 'profile', profile.id);
      const out = await service.getAssignment(T1, 'connection', 'c-local');
      expect(out.inherited).toMatchObject({ target_id: 'local:ollama', profile_id: profile.id });
      expect(out.effective).toMatchObject({ source: 'provider', mode: 'profile' });
    });

    it('a profile chain keeps the Direct item and the disabled server in the effective view', async () => {
      const { service, assign, profile, a, b } = setup();
      assign('connection', 'c-key', 'profile', profile.id);
      const out = await service.getAssignment(T1, 'connection', 'c-key');
      expect((out.effective as Row).chain).toEqual([
        { kind: 'proxy', proxy_id: a.id, name: 'a', enabled: true, line: 1, mode: 'proxy' },
        { kind: 'proxy', proxy_id: b.id, name: 'b', enabled: false, line: 2, mode: 'proxy' },
        { kind: 'direct', proxy_id: null, name: 'Direct', enabled: true, line: 3, mode: 'direct' },
      ]);
    });

    it('a non-connection target has no inherited block', async () => {
      const { service, db, assign, profile } = setup();
      db.triggers.push({
        id: 'tr1',
        tenant_id: T1,
        type: 'webhook',
        name: 'Hook',
        config: { url: 'https://hooks.example/x' },
      });
      assign('trigger', 'tr1', 'profile', profile.id);
      const out = await service.getAssignment(T1, 'trigger', 'tr1');
      expect(out.inherited).toBeUndefined();
      expect(out.effective).toMatchObject({ source: 'trigger', mode: 'profile' });
    });
  });

  describe('targets', () => {
    it('provider defaults must be local:, api_key: or subscription: plus a provider', async () => {
      const { service } = setup();
      for (const id of [
        'openai',
        'free:openai',
        'api_key:',
        'api_key:bad space',
        ':openai',
        `api_key:${'x'.repeat(121)}`,
      ]) {
        expect(
          await httpError(service.setAssignment(T1, 'provider', id, { mode: 'direct' })),
        ).toBeInstanceOf(BadRequestException);
      }
      await expect(
        service.setAssignment(T1, 'provider', 'api_key:openai', { mode: 'direct' }),
      ).resolves.toBeDefined();
      await expect(
        service.setAssignment(T1, 'provider', 'local:llamacpp', { mode: 'direct' }),
      ).resolves.toBeDefined();
      await expect(
        service.setAssignment(T1, 'provider', 'subscription:custom:abc', { mode: 'direct' }),
      ).resolves.toBeDefined();
    });

    it('provider ids are case-insensitive and stored lower case', async () => {
      const { service, db } = setup();
      const out = await service.setAssignment(T1, 'provider', 'API_KEY:OpenAI', { mode: 'direct' });
      expect(out.target_id).toBe('api_key:openai');
      expect(db.assignments).toEqual([expect.objectContaining({ target_id: 'api_key:openai' })]);
    });

    it('a connection must exist in this workspace', async () => {
      const { service } = setup();
      expect(
        await httpError(service.setAssignment(T1, 'connection', 'c-foreign', { mode: 'direct' })),
      ).toBeInstanceOf(NotFoundException);
      expect(await httpError(service.getAssignment(T1, 'connection', 'c-foreign'))).toBeInstanceOf(
        NotFoundException,
      );
      expect(await httpError(service.getAssignment(T1, 'connection', 'missing'))).toBeInstanceOf(
        NotFoundException,
      );
    });

    it('only webhook, Telegram and e-mail triggers can have an outbound path', async () => {
      const { service, db } = setup();
      db.triggers.push(
        { id: 'tg', tenant_id: T1, type: 'telegram', name: 'TG' },
        { id: 'sys', tenant_id: T1, type: 'syslog', name: 'Syslog' },
        { id: 'foreign', tenant_id: T2, type: 'webhook', name: 'F' },
      );
      await expect(
        service.setAssignment(T1, 'trigger', 'tg', { mode: 'direct' }),
      ).resolves.toBeDefined();
      expect(
        await httpError(service.setAssignment(T1, 'trigger', 'sys', { mode: 'direct' })),
      ).toBeInstanceOf(BadRequestException);
      expect(
        await httpError(service.setAssignment(T1, 'trigger', 'foreign', { mode: 'direct' })),
      ).toBeInstanceOf(NotFoundException);
    });

    it('an e-mail config must exist in this workspace', async () => {
      const { service, db } = setup();
      db.emailConfigs.push({ id: 'em1', tenant_id: T1 }, { id: 'em2', tenant_id: T2 });
      await expect(
        service.setAssignment(T1, 'email_config', 'em1', { mode: 'global' }),
      ).resolves.toBeDefined();
      expect(
        await httpError(service.setAssignment(T1, 'email_config', 'em2', { mode: 'global' })),
      ).toBeInstanceOf(NotFoundException);
    });
  });

  describe('setAssignment', () => {
    it('creates, switches and removes an assignment', async () => {
      const { service, db, profile, egress } = setup();
      await service.setAssignment(T1, 'connection', 'c-key', {
        mode: 'profile',
        profile_id: profile.id,
      });
      expect(db.assignments).toEqual([
        {
          tenant_id: T1,
          target_type: 'connection',
          target_id: 'c-key',
          mode: 'profile',
          profile_id: profile.id,
        },
      ]);
      await service.setAssignment(T1, 'connection', 'c-key', { mode: 'direct' });
      expect(db.assignments).toEqual([
        {
          tenant_id: T1,
          target_type: 'connection',
          target_id: 'c-key',
          mode: 'direct',
          profile_id: null,
        },
      ]);
      const out = await service.setAssignment(T1, 'connection', 'c-key', { mode: 'inherit' });
      expect(db.assignments).toEqual([]);
      expect(out.mode).toBe('inherit');
      expect(egress.invalidate).toHaveBeenCalledTimes(3);
      expect(egress.invalidate).toHaveBeenCalledWith(T1);
    });

    it('needs a profile_id in "profile" mode, and the profile must be in the workspace', async () => {
      const { service, db, addProfileRow } = setup();
      const theirs = addProfileRow([], { tenant_id: T2 });
      expect(
        await httpError(service.setAssignment(T1, 'connection', 'c-key', { mode: 'profile' })),
      ).toBeInstanceOf(BadRequestException);
      expect(
        await httpError(
          service.setAssignment(T1, 'connection', 'c-key', { mode: 'profile', profile_id: 42 }),
        ),
      ).toBeInstanceOf(BadRequestException);
      expect(
        await httpError(
          service.setAssignment(T1, 'connection', 'c-key', {
            mode: 'profile',
            profile_id: 'ghost',
          }),
        ),
      ).toBeInstanceOf(NotFoundException);
      expect(
        await httpError(
          service.setAssignment(T1, 'connection', 'c-key', {
            mode: 'profile',
            profile_id: theirs.id,
          }),
        ),
      ).toBeInstanceOf(NotFoundException);
      expect(db.assignments).toEqual([]);
    });

    it('ignores a profile_id outside "profile" mode', async () => {
      const { service, db, profile } = setup();
      await service.setAssignment(T1, 'connection', 'c-key', {
        mode: 'direct',
        profile_id: profile.id,
      });
      expect(db.assignments[0]!.profile_id).toBeNull();
    });

    it('refuses an unknown mode', async () => {
      const { service, db } = setup();
      for (const mode of ['proxy', 'DIRECT', 'none']) {
        expect(
          await httpError(service.setAssignment(T1, 'connection', 'c-key', { mode })),
        ).toBeInstanceOf(BadRequestException);
      }
      expect(db.assignments).toEqual([]);
    });

    it('refuses a mode that is not a string instead of resetting the assignment', async () => {
      const { service, db, assign } = setup();
      assign('connection', 'c-key', 'direct');
      for (const mode of [5, true, {}, null]) {
        expect(
          await httpError(service.setAssignment(T1, 'connection', 'c-key', { mode })),
        ).toBeInstanceOf(BadRequestException);
      }
      expect(db.assignments).toHaveLength(1);
    });

    it('never writes into another workspace', async () => {
      const { service, db } = setup();
      await service.setAssignment(T1, 'provider', 'api_key:openai', { mode: 'direct' });
      expect(db.assignments.every((a) => a.tenant_id === T1)).toBe(true);
      expect(await service.listAssignments(T2)).toMatchObject({ assignments: [] });
    });
  });

  describe('listAssignments', () => {
    it('lists the workspace assignments with profile names, filtered by type', async () => {
      const { service, assign, profile } = setup();
      assign('connection', 'c-key', 'profile', profile.id);
      assign('provider', 'api_key:openai', 'direct');
      assign('provider', 'api_key:openai', 'profile', profile.id, T2);
      const all = await service.listAssignments(T1);
      expect(all.assignments).toEqual([
        expect.objectContaining({
          target_type: 'connection',
          target_id: 'c-key',
          mode: 'profile',
          profile_name: 'Office',
        }),
        expect.objectContaining({
          target_type: 'provider',
          target_id: 'api_key:openai',
          mode: 'direct',
          profile_name: null,
        }),
      ]);
      expect(all.custom_providers).toEqual([
        { id: 'custom:abc', name: 'My Ollama', local_type: 'ollama' },
      ]);
      const onlyProviders = await service.listAssignments(T1, 'provider');
      expect(onlyProviders.assignments).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------

describe('ProxyServersService.get (bindings and suggested test URL)', () => {
  it('lists the profiles that use the proxy and whether removing it empties them', async () => {
    const ctx = build();
    const a = ctx.addServer({ name: 'a' });
    const b = ctx.addServer({ name: 'b' });
    const only = ctx.addProfileRow([a.id], { name: 'Only a' });
    const both = ctx.addProfileRow([a.id, b.id], { name: 'Both' });
    const out = await ctx.service.get(T1, a.id);
    expect(out.binding_count).toBe(2);
    expect(out.bindings).toEqual(
      expect.arrayContaining([
        { target_type: 'profile', target_id: only.id, label: 'Only a', loses_proxy: true },
        { target_type: 'profile', target_id: both.id, label: 'Both', loses_proxy: false },
      ]),
    );
  });

  it('suggests the endpoint of a built-in provider, a custom base URL or a webhook URL', async () => {
    const ctx = build();
    const a = ctx.addServer({ name: 'a' });
    const profile = ctx.addProfileRow([a.id]);
    expect((await ctx.service.get(T1, a.id)).suggested_test_url).toBeNull();

    ctx.assign('provider', 'api_key:openai', 'profile', profile.id);
    expect((await ctx.service.get(T1, a.id)).suggested_test_url).toMatch(
      /^https:\/\/api\.openai\.com/,
    );

    ctx.db.assignments.length = 0;
    ctx.db.customProviders.push({
      id: 'abc',
      tenant_id: T1,
      name: 'Mine',
      base_url: 'http://10.1.1.1:8080/v1',
    });
    ctx.assign('provider', 'api_key:custom:abc', 'profile', profile.id);
    expect((await ctx.service.get(T1, a.id)).suggested_test_url).toBe('http://10.1.1.1:8080/v1');

    ctx.db.assignments.length = 0;
    ctx.db.triggers.push({
      id: 'hook',
      tenant_id: T1,
      type: 'webhook',
      name: 'Hook',
      config: JSON.stringify({ url: 'https://hooks.example/in' }),
    });
    ctx.assign('trigger', 'hook', 'profile', profile.id);
    expect((await ctx.service.get(T1, a.id)).suggested_test_url).toBe('https://hooks.example/in');

    // A templated URL is not a usable test target.
    ctx.db.triggers[0]!.config = { url: 'https://hooks.example/{{id}}' };
    expect((await ctx.service.get(T1, a.id)).suggested_test_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('ProxyServersService.logs', () => {
  it('always filters by the workspace and the proxy', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    await service.logs(T1, row.id, {});
    const [sql, params] = db.calls.find(([s]) => s.includes('FROM proxy_logs'))!;
    expect(sql).toContain('tenant_id = $1 AND proxy_id = $2');
    expect(params.slice(0, 2)).toEqual([T1, row.id]);
    expect(sql).not.toMatch(/password/i);
  });

  it('parameterizes the filters (no SQL from the query string)', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    await service.logs(T1, row.id, {
      result: "x'; DROP TABLE proxy_logs; --",
      source_type: 'connection',
      from: '2026-11-01T00:00:00Z',
      to: '2026-11-02T00:00:00Z',
      before: '2026-11-01T12:00:00Z',
    });
    const [sql, params] = db.calls.find(([s]) => s.includes('FROM proxy_logs'))!;
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toEqual([
      T1,
      row.id,
      "x'; DROP TABLE proxy_logs; --",
      'connection',
      '2026-11-01T00:00:00.000Z',
      '2026-11-02T00:00:00.000Z',
      '2026-11-01T12:00:00.000Z',
    ]);
  });

  it('maps result=ok and result=failure to fixed predicates', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    await service.logs(T1, row.id, { result: 'ok' });
    await service.logs(T1, row.id, { result: 'failure' });
    const sqls = db.calls.filter(([s]) => s.includes('FROM proxy_logs')).map(([s]) => s);
    expect(sqls[0]).toContain("result = 'ok'");
    expect(sqls[1]).toContain("result <> 'ok'");
  });

  it('rejects an invalid date with 400', async () => {
    const { service, addServer } = build();
    const row = addServer();
    for (const q of [{ from: 'yesterday' }, { to: 'x' }, { before: '31/31/2026' }]) {
      expect(await httpError(service.logs(T1, row.id, q))).toBeInstanceOf(BadRequestException);
    }
  });

  it('clamps the page size between 1 and 200 and defaults to 50', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    const limits: number[] = [];
    for (const limit of [undefined, '0', '-5', '9999', 'abc', '7']) {
      db.calls.length = 0;
      await service.logs(T1, row.id, { limit });
      limits.push(
        Number(/LIMIT (\d+)/.exec(db.calls.find(([s]) => s.includes('FROM proxy_logs'))![0])![1]) -
          1,
      );
    }
    expect(limits).toEqual([50, 50, 1, 200, 50, 7]);
  });

  it('paginates with next_before and converts byte counters to numbers', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    db.logs = [
      {
        id: 'l3',
        started_at: '2026-11-01T10:03:00.000Z',
        cursor_at: '2026-11-01T10:03:00.000000Z',
        bytes_sent: '10',
        bytes_received: '20',
      },
      {
        id: 'l2',
        started_at: '2026-11-01T10:02:00.000Z',
        cursor_at: '2026-11-01T10:02:00.123456Z',
        bytes_sent: '1',
        bytes_received: '2',
      },
      {
        id: 'l1',
        started_at: '2026-11-01T10:01:00.000Z',
        cursor_at: '2026-11-01T10:01:00.000000Z',
        bytes_sent: '0',
        bytes_received: '0',
      },
    ];
    const page = await service.logs(T1, row.id, { limit: '2' });
    expect(page.logs.map((l) => (l as Row).id)).toEqual(['l3', 'l2']);
    expect(page.logs[0]).toMatchObject({ bytes_sent: 10, bytes_received: 20 });
    expect(page.next_before).toBe('2026-11-01T10:02:00.123456Z');
    expect(page.logs[0]).not.toHaveProperty('cursor_at');
    const last = await service.logs(T1, row.id, { limit: '3' });
    expect(last.next_before).toBeNull();
  });
});

describe('ProxyServersService.stats', () => {
  it('maps the aggregates, labels the sources and keeps the failure codes', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    db.connections.push({
      id: 'c1',
      tenant_id: T1,
      provider: 'openai',
      auth_type: 'api_key',
      label: 'Default',
    });
    db.triggers.push({ id: 'tr1', tenant_id: T1, name: 'Hook', type: 'webhook' });
    db.statsDaily = [
      {
        day: '2026-11-01',
        connections: '10',
        successes: '8',
        failures: '2',
        tunnel_sum: '400',
        tunnel_samples: '8',
        tunnel_max: '90',
        bytes_sent: '1000',
        bytes_received: '5000',
        fallback_uses: '1',
      },
      {
        day: '2026-11-02',
        connections: '0',
        successes: '0',
        failures: '0',
        tunnel_sum: '0',
        tunnel_samples: '0',
        tunnel_max: '0',
        bytes_sent: '0',
        bytes_received: '0',
        fallback_uses: '0',
      },
    ];
    db.statsBySource = [
      {
        source_type: 'connection',
        source_id: 'c1',
        connections: '6',
        successes: '5',
        failures: '1',
        bytes_sent: '1',
        bytes_received: '2',
        fallback_uses: '0',
      },
      {
        source_type: 'trigger',
        source_id: 'tr1',
        connections: '3',
        successes: '3',
        failures: '0',
        bytes_sent: '1',
        bytes_received: '2',
        fallback_uses: '1',
      },
      {
        source_type: 'trigger',
        source_id: 'deleted',
        connections: '1',
        successes: '1',
        failures: '0',
        bytes_sent: '0',
        bytes_received: '0',
        fallback_uses: '0',
      },
      {
        source_type: 'test',
        source_id: '',
        connections: '1',
        successes: '0',
        failures: '1',
        bytes_sent: '0',
        bytes_received: '0',
        fallback_uses: '0',
      },
    ];
    db.statsCodes = [
      { code: 'auth_407', count: '2' },
      { code: 'refused', count: '1' },
    ];
    const out = await service.stats(T1, row.id);
    expect(out.days).toBe(30);
    expect(out.daily).toEqual([
      {
        day: '2026-11-01',
        connections: 10,
        successes: 8,
        failures: 2,
        avg_tunnel_ms: 50,
        max_tunnel_ms: 90,
        bytes_sent: 1000,
        bytes_received: 5000,
        fallback_uses: 1,
      },
      {
        day: '2026-11-02',
        connections: 0,
        successes: 0,
        failures: 0,
        avg_tunnel_ms: null,
        max_tunnel_ms: 0,
        bytes_sent: 0,
        bytes_received: 0,
        fallback_uses: 0,
      },
    ]);
    expect(out.by_source.map((s) => [s.source_type, s.source_id, s.label, s.connections])).toEqual([
      ['connection', 'c1', 'openai / Default', 6],
      ['trigger', 'tr1', 'Hook', 3],
      ['trigger', 'deleted', 'deleted', 1],
      ['test', null, 'Test', 1],
    ]);
    expect(out.failures_by_code).toEqual({ auth_407: 2, refused: 1 });
  });

  it('an unused proxy has empty statistics', async () => {
    const { service, addServer } = build();
    const row = addServer();
    expect(await service.stats(T1, row.id)).toEqual({
      days: 30,
      daily: [],
      by_source: [],
      failures_by_code: {},
    });
  });

  it('scopes every aggregate to the workspace and the proxy', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    await service.stats(T1, row.id, '7');
    const usage = db.calls.filter(([s]) => s.includes('FROM proxy_usage_daily'));
    expect(usage).toHaveLength(3);
    for (const [sql, params] of usage) {
      expect(sql).toMatch(
        /tenant_id = \$1 AND (u\.)?proxy_id = \$2|u\.tenant_id = \$1 AND u\.proxy_id = \$2/,
      );
      expect(params).toEqual([T1, row.id, 6]);
    }
  });

  it('clamps the window to 1-365 days and defaults to 30', async () => {
    const { service, addServer } = build();
    const row = addServer();
    const days = await Promise.all(
      [undefined, '0', '-3', '1', '90', '365', '366', '100000', 'abc'].map(
        async (d) => (await service.stats(T1, row.id, d)).days,
      ),
    );
    expect(days).toEqual([30, 30, 1, 1, 90, 365, 365, 365, 30]);
  });

  it('rounds a fractional days value to a whole number of days', async () => {
    const { service, db, addServer } = build();
    const row = addServer();
    const out = await service.stats(T1, row.id, '2.5');
    expect(Number.isInteger(out.days)).toBe(true);
    for (const [, params] of db.calls.filter(([s]) => s.includes('FROM proxy_usage_daily'))) {
      expect(Number.isInteger(params[2])).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('ProxyServersService.test', () => {
  it('refuses a missing, relative or non-http URL', async () => {
    const { service, addServer, egress } = build();
    const row = addServer();
    for (const body of [
      undefined,
      {},
      { url: '' },
      { url: 12 },
      { url: '/relative' },
      { url: 'ftp://x.example/' },
      { url: 'file:///etc/passwd' },
    ]) {
      expect(await httpError(service.test(T1, row.id, body as never))).toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(egress.record).not.toHaveBeenCalled();
  });

  describe('against a loopback CONNECT proxy', () => {
    let target: Server;
    let targetPort: number;
    let proxy: Server;
    let proxyPort: number;
    let proxyCreds: string | null = null;
    const connects: string[] = [];
    const sockets = new Set<Socket>();

    beforeAll(async () => {
      target = createServer((_req, res) => res.end('ok'));
      await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
      targetPort = (target.address() as AddressInfo).port;
      proxy = createServer((_req, res) => res.end());
      proxy.on('connection', (s) => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
      });
      proxy.on('connect', (req: IncomingMessage, client: Socket) => {
        connects.push(req.url ?? '');
        if (proxyCreds) {
          const expected = `Basic ${Buffer.from(proxyCreds).toString('base64')}`;
          if (req.headers['proxy-authorization'] !== expected) {
            client.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
            return;
          }
        }
        const { connect } = jest.requireActual('node:net') as typeof import('node:net');
        const [host, port] = (req.url ?? '').split(':');
        const upstream = connect(Number(port), host, () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.on('error', () => client.destroy());
        client.on('error', () => upstream.destroy());
      });
      await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
      proxyPort = (proxy.address() as AddressInfo).port;
    });

    afterAll(async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => proxy.close(() => r()));
      await new Promise<void>((r) => target.close(() => r()));
      await clearProxyAgentCache();
    });

    beforeEach(() => {
      connects.length = 0;
      proxyCreds = null;
    });

    it('tunnels through the proxy and records a "test" use of it', async () => {
      const { service, addServer, egress } = build();
      const row = addServer({ host: '127.0.0.1', port: proxyPort });
      const out = await service.test(T1, row.id, { url: `http://127.0.0.1:${targetPort}/ping` });
      expect(out).toMatchObject({ ok: true, result: 'ok', status: 200, error: null });
      expect(out.tunnel_ms).not.toBeNull();
      expect(connects).toEqual([`127.0.0.1:${targetPort}`]);
      expect(egress.record).toHaveBeenCalledTimes(1);
      const event = egress.record.mock.calls[0]![0];
      expect(event.scope).toMatchObject({ tenantId: T1, sourceType: 'test', chain: null });
      expect(event.destination).toBe(`127.0.0.1:${targetPort}`);
      expect(event.hop).toMatchObject({ kind: 'proxy', proxy_id: row.id, result: 'ok' });
    });

    it('also tests a disabled proxy', async () => {
      const { service, addServer } = build();
      const row = addServer({ host: '127.0.0.1', port: proxyPort, enabled: false });
      const out = await service.test(T1, row.id, { url: `http://127.0.0.1:${targetPort}/` });
      expect(out.ok).toBe(true);
    });

    it('sends the stored credentials, decrypted, and never echoes them back', async () => {
      proxyCreds = `alice:${SECRET}`;
      const { service, db } = build();
      const created = await service.create(T1, 'u', {
        name: 'Auth',
        host: '127.0.0.1',
        port: proxyPort,
        username: 'alice',
        password: SECRET,
      });
      expect(db.servers[0]!.password_encrypted).not.toContain(SECRET);
      const out = await service.test(T1, created.id, { url: `http://127.0.0.1:${targetPort}/` });
      expect(out).toMatchObject({ ok: true, status: 200 });
      expect(JSON.stringify(out)).not.toContain(SECRET);
    });

    it('reports a proxy authentication failure as auth_407 without leaking the password', async () => {
      proxyCreds = `alice:right-password`;
      const { service, addServer, egress } = build();
      const row = addServer({ host: '127.0.0.1', port: proxyPort, username: 'alice' });
      const out = await service.test(T1, row.id, { url: `http://127.0.0.1:${targetPort}/` });
      expect(out).toMatchObject({ ok: false, result: 'auth_407', tunnel_ms: null });
      expect(out.status).toBe(407);
      const event = egress.record.mock.calls[0]![0];
      expect(event.hop.result).toBe('auth_407');
      expect(JSON.stringify([out, event.hop])).not.toContain('right-password');
    });

    it('reports a refused connection to the proxy', async () => {
      const closed = createServer();
      await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
      const { port } = closed.address() as AddressInfo;
      await new Promise<void>((r) => closed.close(() => r()));
      const { service, addServer } = build();
      const row = addServer({ host: '127.0.0.1', port });
      const out = await service.test(T1, row.id, { url: `http://127.0.0.1:${targetPort}/` });
      expect(out).toMatchObject({ ok: false, result: 'refused', status: null });
      expect(out.error).toBeTruthy();
    });

    it('refuses a cloud metadata destination before sending anything', async () => {
      const { service, addServer } = build();
      const row = addServer({ host: '127.0.0.1', port: proxyPort });
      const out = await service.test(T1, row.id, {
        url: 'http://169.254.169.254/latest/meta-data',
      });
      expect(out.ok).toBe(false);
      expect(connects).toEqual([]);
    });

    it('still answers when recording the use fails', async () => {
      const { service, addServer, egress } = build();
      egress.record.mockRejectedValue(new Error('db down'));
      const row = addServer({ host: '127.0.0.1', port: proxyPort });
      await expect(
        service.test(T1, row.id, { url: `http://127.0.0.1:${targetPort}/` }),
      ).resolves.toMatchObject({ ok: true });
    });
  });
});
