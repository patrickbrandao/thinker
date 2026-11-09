/**
 * Outbound proxy servers, profiles and assignments over HTTP: CRUD and
 * validation, secret handling, role gate, tenant isolation, the Test button
 * (against a loopback CONNECT proxy, never the internet), statistics, logs and
 * how the topology attributes egress to servers, the gateway and the global
 * proxy.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { createTestApp, TEST_API_KEY, TEST_TENANT_ID, TEST_USER_ID } from './helpers';
import { closeServer, LOOPBACK_HOST, serveOnLoopback } from './loopback';
import { ProxyServersModule } from '../src/proxy-servers/proxy-servers.module';
import { decryptProxyPassword } from '../src/proxy-servers/proxy-egress.service';
import {
  clearProxyAgentCache,
  parseGlobalProxyEnv,
  setGlobalProxyConfigForTests,
} from '../src/common/outbound/outbound-proxy';

const ADMIN = 'px-admin';
const MEMBER = 'px-member';
const VIEWER = 'px-viewer';
const OUTSIDER = 'px-outsider';
const ORG_B = 'px-org-b';
const PASSWORD = 'Sup3r-S3cret-px-password';

let app: INestApplication;
let ds: DataSource;

const api = () => request(app.getHttpServer());
const as = (userId: string, req: request.Test, orgId?: string) => {
  const r = req.set('x-api-key', TEST_API_KEY).set('x-test-user-id', userId);
  return orgId ? r.set('x-thinker-organization', orgId) : r;
};
const asOwner = (req: request.Test) => req.set('x-api-key', TEST_API_KEY);
const asAdmin = (req: request.Test) => as(ADMIN, req);
const asB = (req: request.Test) => as(OUTSIDER, req, ORG_B);

/** Loopback CONNECT proxy that can demand Basic credentials. */
interface LoopProxy {
  port: number;
  connects: string[];
  creds: string | null;
  close: () => Promise<void>;
}
async function startConnectProxy(): Promise<LoopProxy> {
  const sockets = new Set<Socket>();
  const state: LoopProxy = {
    port: 0,
    connects: [],
    creds: null,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        srv.close(() => resolve());
      }),
  };
  const srv: Server = createServer((_req, res) => res.end());
  srv.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  srv.on('connect', (req: IncomingMessage, client: Socket) => {
    state.connects.push(req.url ?? '');
    if (state.creds) {
      const expected = `Basic ${Buffer.from(state.creds).toString('base64')}`;
      if (req.headers['proxy-authorization'] !== expected) {
        client.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
        return;
      }
    }
    const [host, port] = (req.url ?? '').split(':');
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => srv.listen(0, LOOPBACK_HOST, resolve));
  state.port = (srv.address() as AddressInfo).port;
  return state;
}

async function closedPort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, LOOPBACK_HOST, resolve));
  const { port } = srv.address() as AddressInfo;
  await closeServer(srv);
  return port;
}

let target: Server;
let targetUrl: string;
let loop: LoopProxy;

beforeAll(async () => {
  app = await createTestApp({ extraImports: [ProxyServersModule] });
  ds = app.get(DataSource);
  await ds.query(
    `INSERT INTO organization_members (tenant_id, user_id, role) VALUES
       ($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'member'), ($1, $5, 'viewer')`,
    [TEST_TENANT_ID, TEST_USER_ID, ADMIN, MEMBER, VIEWER],
  );
  await ds.query(
    `INSERT INTO tenants (id, name, organization_name, is_active) VALUES ($1, $1, 'Org B', true)`,
    [ORG_B],
  );
  await ds.query(
    `INSERT INTO organization_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [ORG_B, OUTSIDER],
  );
  target = await serveOnLoopback((_req, res) => res.end('pong'));
  targetUrl = `http://${LOOPBACK_HOST}:${(target.address() as AddressInfo).port}/ping`;
  loop = await startConnectProxy();
}, 60000);

afterAll(async () => {
  setGlobalProxyConfigForTests(null);
  await loop?.close();
  if (target) await closeServer(target);
  await clearProxyAgentCache();
  await app.close();
});

const server = (body: Record<string, unknown> = {}) => ({
  name: `px-${randomUUID().slice(0, 8)}`,
  host: '10.20.30.40',
  port: 3128,
  ...body,
});
async function createServerAs(
  send: (r: request.Test) => request.Test,
  body: Record<string, unknown> = {},
) {
  const res = await send(api().post('/api/v1/proxy-servers')).send(server(body)).expect(201);
  return res.body as { id: string; name: string };
}

describe('authentication and role gate', () => {
  const routes: Array<[string, string]> = [
    ['get', '/api/v1/proxy-servers'],
    ['post', '/api/v1/proxy-servers'],
    ['get', '/api/v1/proxy-servers/x'],
    ['patch', '/api/v1/proxy-servers/x'],
    ['delete', '/api/v1/proxy-servers/x'],
    ['post', '/api/v1/proxy-servers/x/test'],
    ['get', '/api/v1/proxy-servers/x/logs'],
    ['get', '/api/v1/proxy-servers/x/stats'],
    ['get', '/api/v1/proxy-profiles'],
    ['post', '/api/v1/proxy-profiles'],
    ['patch', '/api/v1/proxy-profiles/x'],
    ['delete', '/api/v1/proxy-profiles/x'],
    ['get', '/api/v1/proxy-assignments'],
    ['get', '/api/v1/proxy-assignments/provider/api_key:openai'],
    ['put', '/api/v1/proxy-assignments/provider/api_key:openai'],
  ];

  it.each(routes)('answers 401 to %s %s without credentials', async (method, path) => {
    const res = await (api() as unknown as Record<string, (p: string) => request.Test>)[method]!(
      path,
    );
    expect(res.status).toBe(401);
  });

  it.each([
    ['viewer', VIEWER],
    ['member', MEMBER],
  ])('keeps a %s out of every route, reads included', async (_role, user) => {
    for (const [method, path] of routes) {
      const res = await as(
        user,
        (api() as unknown as Record<string, (p: string) => request.Test>)[method]!(path),
      ).send(method === 'get' ? undefined : {});
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 403 });
      expect(res.body.code).toBe('insufficient_role');
    }
  });

  it('lets admins and owners in', async () => {
    await asAdmin(api().get('/api/v1/proxy-servers')).expect(200);
    await asOwner(api().get('/api/v1/proxy-servers')).expect(200);
    await asAdmin(api().get('/api/v1/proxy-profiles')).expect(200);
    await asAdmin(api().get('/api/v1/proxy-assignments')).expect(200);
  });

  it('refuses an organization the caller does not belong to', async () => {
    const res = await as(ADMIN, api().get('/api/v1/proxy-servers'), ORG_B).expect(403);
    expect(res.body.code).toBe('not_a_member');
  });
});

describe('proxy servers', () => {
  it('creates a server with defaults and lists it', async () => {
    const res = await asAdmin(api().post('/api/v1/proxy-servers'))
      .send({ name: 'Edge EU', host: 'Edge-EU.LOCALHOST', port: 8080 })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Edge EU',
      scheme: 'http',
      host: 'edge-eu.localhost',
      port: 8080,
      username: null,
      has_password: false,
      enabled: true,
      connect_timeout_ms: 10000,
      debug_enabled: false,
      log_retention_days: null,
      status: 'idle',
      binding_count: 0,
      stats_7d: null,
      bindings: [],
      suggested_test_url: null,
    });
    const rows = await ds.query(
      `SELECT tenant_id, created_by_user_id FROM proxy_servers WHERE id = $1`,
      [res.body.id],
    );
    expect(rows[0]).toEqual({ tenant_id: TEST_TENANT_ID, created_by_user_id: ADMIN });

    const list = await asAdmin(api().get('/api/v1/proxy-servers')).expect(200);
    expect(list.body.proxies.map((p: { name: string }) => p.name)).toContain('Edge EU');
    expect(list.body).toHaveProperty('global');
    const one = await asAdmin(api().get(`/api/v1/proxy-servers/${res.body.id}`)).expect(200);
    expect(one.body.id).toBe(res.body.id);
  });

  it.each([
    ['a missing name', { host: '10.0.0.1', port: 1 }],
    ['a blank name', { name: ' ', host: '10.0.0.1', port: 1 }],
    ['an unknown scheme', { name: 'x1', host: '10.0.0.1', port: 1, scheme: 'socks5' }],
    ['a host with a scheme', { name: 'x2', host: 'http://h.example', port: 1 }],
    ['a host with a port', { name: 'x3', host: 'h.example:80', port: 1 }],
    ['a cloud metadata host', { name: 'x4', host: '169.254.169.254', port: 80 }],
    ['port 0', { name: 'x5', host: '10.0.0.1', port: 0 }],
    ['port 70000', { name: 'x6', host: '10.0.0.1', port: 70000 }],
    ['a tiny timeout', { name: 'x7', host: '10.0.0.1', port: 1, connect_timeout_ms: 10 }],
    ['a password without a username', { name: 'x8', host: '10.0.0.1', port: 1, password: 'pw' }],
    ['a bad debug value', { name: 'x9', host: '10.0.0.1', port: 1, debug: 'always' }],
    ['a bad retention', { name: 'x10', host: '10.0.0.1', port: 1, log_retention_days: 0 }],
  ])('answers 400 for %s and stores nothing', async (_label, body) => {
    const before = (await ds.query(`SELECT count(*)::int AS n FROM proxy_servers`))[0].n;
    const res = await asAdmin(api().post('/api/v1/proxy-servers')).send(body).expect(400);
    expect(res.body.statusCode).toBe(400);
    expect((await ds.query(`SELECT count(*)::int AS n FROM proxy_servers`))[0].n).toBe(before);
  });

  it('answers 400 to an empty body', async () => {
    await asAdmin(api().post('/api/v1/proxy-servers')).send({}).expect(400);
  });

  it('refuses a duplicate name, ignoring case', async () => {
    const created = await createServerAs(asAdmin, { name: 'Dup Check' });
    const res = await asAdmin(api().post('/api/v1/proxy-servers'))
      .send(server({ name: created.name.toUpperCase() }))
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/already exists/);
  });

  it('encrypts the password at rest and never returns it', async () => {
    const res = await asAdmin(api().post('/api/v1/proxy-servers'))
      .send(server({ username: 'alice', password: PASSWORD }))
      .expect(201);
    expect(res.body).toMatchObject({ username: 'alice', has_password: true });
    const [{ password_encrypted: stored }] = await ds.query(
      `SELECT password_encrypted FROM proxy_servers WHERE id = $1`,
      [res.body.id],
    );
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(PASSWORD);
    expect(decryptProxyPassword(stored)).toBe(PASSWORD);

    for (const out of [
      res,
      await asAdmin(api().get(`/api/v1/proxy-servers/${res.body.id}`)),
      await asAdmin(api().get('/api/v1/proxy-servers')),
      await asAdmin(api().get(`/api/v1/proxy-servers/${res.body.id}/logs`)),
      await asAdmin(api().get(`/api/v1/proxy-servers/${res.body.id}/stats`)),
    ]) {
      const text = JSON.stringify(out.body);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(stored);
      expect(text).not.toMatch(/password_encrypted|"password"/);
    }
  });

  it('keeps the password on edits that do not send one, replaces it, and clears it with auth "none"', async () => {
    const created = await createServerAs(asAdmin, { username: 'bob', password: PASSWORD });
    const read = async () =>
      (
        await ds.query(`SELECT username, password_encrypted FROM proxy_servers WHERE id = $1`, [
          created.id,
        ])
      )[0];
    const first = (await read()).password_encrypted;

    const patched = await asAdmin(api().patch(`/api/v1/proxy-servers/${created.id}`))
      .send({ port: 9999, password: '' })
      .expect(200);
    expect(patched.body).toMatchObject({ port: 9999, has_password: true });
    expect((await read()).password_encrypted).toBe(first);

    await asAdmin(api().patch(`/api/v1/proxy-servers/${created.id}`))
      .send({ password: 'another-password-1' })
      .expect(200);
    const second = (await read()).password_encrypted;
    expect(second).not.toBe(first);
    expect(decryptProxyPassword(second)).toBe('another-password-1');

    const cleared = await asAdmin(api().patch(`/api/v1/proxy-servers/${created.id}`))
      .send({ auth: 'none' })
      .expect(200);
    expect(cleared.body).toMatchObject({ username: null, has_password: false });
    expect(await read()).toEqual({ username: null, password_encrypted: null });
  });

  it('updates only the sent fields, disables the server and reflects it in the status', async () => {
    const created = await createServerAs(asAdmin, { name: 'Patchable', port: 3128 });
    const res = await asAdmin(api().patch(`/api/v1/proxy-servers/${created.id}`))
      .send({ enabled: false, connect_timeout_ms: 2500, log_retention_days: 7, debug: '1h' })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Patchable',
      port: 3128,
      enabled: false,
      status: 'disabled',
      connect_timeout_ms: 2500,
      log_retention_days: 7,
      debug_enabled: true,
    });
    expect(new Date(res.body.debug_until).getTime()).toBeGreaterThan(Date.now());
    await asAdmin(api().patch(`/api/v1/proxy-servers/${created.id}`))
      .send({ debug: 'off', enabled: true })
      .expect(200);
    const back = await asAdmin(api().get(`/api/v1/proxy-servers/${created.id}`)).expect(200);
    expect(back.body).toMatchObject({ enabled: true, debug_enabled: false, debug_until: null });
  });

  it('refuses invalid edits and duplicate names on edit', async () => {
    const a = await createServerAs(asAdmin, { name: 'Edit A' });
    const b = await createServerAs(asAdmin, { name: 'Edit B' });
    await asAdmin(api().patch(`/api/v1/proxy-servers/${b.id}`))
      .send({ name: 'edit a' })
      .expect(400);
    await asAdmin(api().patch(`/api/v1/proxy-servers/${b.id}`))
      .send({ port: 'abc' })
      .expect(400);
    await asAdmin(api().patch(`/api/v1/proxy-servers/${b.id}`))
      .send({ enabled: 'no' })
      .expect(400);
    await asAdmin(api().patch(`/api/v1/proxy-servers/${b.id}`))
      .send({ password: 'pw' })
      .expect(400);
    await asAdmin(api().patch(`/api/v1/proxy-servers/${a.id}`))
      .send({ name: 'EDIT A' })
      .expect(200);
  });

  it('answers 404 for an unknown server on every route', async () => {
    const id = randomUUID();
    await asAdmin(api().get(`/api/v1/proxy-servers/${id}`)).expect(404);
    await asAdmin(api().patch(`/api/v1/proxy-servers/${id}`))
      .send({ name: 'x' })
      .expect(404);
    await asAdmin(api().delete(`/api/v1/proxy-servers/${id}`)).expect(404);
    await asAdmin(api().post(`/api/v1/proxy-servers/${id}/test`))
      .send({ url: targetUrl })
      .expect(404);
    await asAdmin(api().get(`/api/v1/proxy-servers/${id}/logs`)).expect(404);
    await asAdmin(api().get(`/api/v1/proxy-servers/${id}/stats`)).expect(404);
  });

  describe('deleting', () => {
    it('removes an unused server', async () => {
      const created = await createServerAs(asAdmin);
      const res = await asAdmin(api().delete(`/api/v1/proxy-servers/${created.id}`)).expect(200);
      expect(res.body).toEqual({ deleted: true, affected: 0 });
      await asAdmin(api().get(`/api/v1/proxy-servers/${created.id}`)).expect(404);
    });

    it('answers 409 with the profiles using it, and changes nothing', async () => {
      const a = await createServerAs(asAdmin);
      const b = await createServerAs(asAdmin);
      const only = await asAdmin(api().post('/api/v1/proxy-profiles'))
        .send({ name: `only-${a.name}`, chain: [a.id] })
        .expect(201);
      const both = await asAdmin(api().post('/api/v1/proxy-profiles'))
        .send({ name: `both-${a.name}`, chain: [a.id, b.id, 'direct'] })
        .expect(201);
      const res = await asAdmin(api().delete(`/api/v1/proxy-servers/${a.id}`)).expect(409);
      expect(res.body).toMatchObject({ statusCode: 409, error: 'proxy_in_use' });
      expect(res.body.bindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ target_id: only.body.id, loses_proxy: true }),
          expect.objectContaining({ target_id: both.body.id, loses_proxy: false }),
        ]),
      );
      await asAdmin(api().delete(`/api/v1/proxy-servers/${a.id}?mode=purge`)).expect(409);
      await asAdmin(api().get(`/api/v1/proxy-servers/${a.id}`)).expect(200);
    });

    it('mode=remove drops the server from every chain', async () => {
      const a = await createServerAs(asAdmin);
      const b = await createServerAs(asAdmin);
      const profile = await asAdmin(api().post('/api/v1/proxy-profiles'))
        .send({ name: `rm-${a.name}`, chain: [a.id, 'direct', b.id] })
        .expect(201);
      const res = await asAdmin(api().delete(`/api/v1/proxy-servers/${a.id}?mode=remove`)).expect(
        200,
      );
      expect(res.body).toEqual({ deleted: true, affected: 1 });
      const after = await asAdmin(api().get('/api/v1/proxy-profiles')).expect(200);
      const chain = after.body.profiles.find((p: { id: string }) => p.id === profile.body.id).chain;
      // Direct cannot lead a chain, so it moves behind the surviving proxy.
      expect(chain.map((i: { kind: string; proxy_id: string | null }) => i.proxy_id)).toEqual([
        b.id,
        null,
      ]);
    });

    it('mode=replace swaps in another server of the same workspace', async () => {
      const a = await createServerAs(asAdmin);
      const b = await createServerAs(asAdmin);
      const profile = await asAdmin(api().post('/api/v1/proxy-profiles'))
        .send({ name: `rp-${a.name}`, chain: [a.id] })
        .expect(201);
      await asAdmin(api().delete(`/api/v1/proxy-servers/${a.id}?mode=replace`)).expect(400);
      await asAdmin(
        api().delete(`/api/v1/proxy-servers/${a.id}?mode=replace&replace_with=${a.id}`),
      ).expect(400);
      await asAdmin(
        api().delete(`/api/v1/proxy-servers/${a.id}?mode=replace&replace_with=${randomUUID()}`),
      ).expect(404);
      await asAdmin(
        api().delete(`/api/v1/proxy-servers/${a.id}?mode=replace&replace_with=${b.id}`),
      ).expect(200);
      const after = await asAdmin(api().get('/api/v1/proxy-profiles')).expect(200);
      const chain = after.body.profiles.find((p: { id: string }) => p.id === profile.body.id).chain;
      expect(chain).toEqual([expect.objectContaining({ kind: 'proxy', proxy_id: b.id })]);
    });
  });
});

describe('proxy profiles', () => {
  let a: { id: string; name: string };
  let b: { id: string; name: string };
  beforeAll(async () => {
    a = await createServerAs(asAdmin, { name: 'Profile A' });
    b = await createServerAs(asAdmin, { name: 'Profile B' });
    await asAdmin(api().patch(`/api/v1/proxy-servers/${b.id}`))
      .send({ enabled: false })
      .expect(200);
  });

  it('creates a balanced profile and reads its lines back', async () => {
    const res = await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({
        name: 'Balance-First',
        lines: [
          { mode: 'affinity', proxies: [a.id, b.id], no_session: 'agent' },
          { mode: 'direct' },
        ],
      })
      .expect(201);
    expect(
      res.body.lines.map(
        (l: { line: number; mode: string; no_session: string; members: unknown[] }) => [
          l.line,
          l.mode,
          l.no_session,
          l.members.length,
        ],
      ),
    ).toEqual([
      [1, 'affinity', 'agent', 2],
      [2, 'direct', 'request', 1],
    ]);
    const stored = await ds.query(
      `SELECT line, mode, on_failure, no_session FROM proxy_profile_lines WHERE profile_id = $1 ORDER BY line`,
      [res.body.id],
    );
    expect(stored).toEqual([
      { line: 1, mode: 'affinity', on_failure: 'next_member', no_session: 'agent' },
      { line: 2, mode: 'direct', on_failure: 'next_member', no_session: 'request' },
    ]);
    await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({
        name: 'Repeat',
        lines: [
          { mode: 'request', proxies: [a.id, b.id] },
          { mode: 'proxy', proxies: [a.id] },
        ],
      })
      .expect(400);
    await asAdmin(api().delete(`/api/v1/proxy-profiles/${res.body.id}`)).expect(200);
    const left = await ds.query(`SELECT 1 FROM proxy_profile_lines WHERE profile_id = $1`, [
      res.body.id,
    ]);
    expect(left).toEqual([]);
  });

  it('creates a profile whose chain has a Direct item and a disabled server', async () => {
    const res = await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({ name: 'Chain', chain: [a.id, b.id, 'direct'] })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Chain', used_by: [] });
    expect(res.body.chain).toEqual([
      { kind: 'proxy', proxy_id: a.id, name: 'Profile A', enabled: true, line: 1, mode: 'proxy' },
      { kind: 'proxy', proxy_id: b.id, name: 'Profile B', enabled: false, line: 2, mode: 'proxy' },
      { kind: 'direct', proxy_id: null, name: 'Direct', enabled: true, line: 3, mode: 'direct' },
    ]);
    const bindings = await ds.query(
      `SELECT position, proxy_id FROM proxy_bindings WHERE target_type = 'profile' AND target_id = $1 ORDER BY position`,
      [res.body.id],
    );
    expect(bindings).toEqual([
      { position: 1, proxy_id: a.id },
      { position: 2, proxy_id: b.id },
      { position: 3, proxy_id: null },
    ]);
    const list = await asAdmin(api().get('/api/v1/proxy-profiles')).expect(200);
    expect(list.body.profiles.map((p: { name: string }) => p.name)).toContain('Chain');
  });

  it.each([
    ['no name', () => ({ chain: [a.id] })],
    ['an empty chain', () => ({ name: 'e1', chain: [] })],
    ['a missing chain', () => ({ name: 'e2' })],
    ['Direct first', () => ({ name: 'e3', chain: ['direct', a.id] })],
    ['Direct twice', () => ({ name: 'e4', chain: [a.id, 'direct', 'direct'] })],
    ['a repeated server', () => ({ name: 'e5', chain: [a.id, a.id] })],
    ['an unknown server', () => ({ name: 'e6', chain: [randomUUID()] })],
    [
      'a chain longer than six',
      () => ({ name: 'e7', chain: [a.id, b.id, 'direct', 'x', 'y', 'z', 'w'] }),
    ],
  ])('answers 400 for %s', async (_label, body) => {
    await asAdmin(api().post('/api/v1/proxy-profiles')).send(body()).expect(400);
  });

  it('answers 409 to a duplicate name, ignoring case', async () => {
    await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({ name: 'Dupe', chain: [a.id] })
      .expect(201);
    await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({ name: 'DUPE', chain: [a.id] })
      .expect(409);
  });

  it('updates the name and chain, and keeps the old ones on an invalid update', async () => {
    const created = await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({ name: 'Mutable', chain: [a.id] })
      .expect(201);
    await asAdmin(api().patch(`/api/v1/proxy-profiles/${created.body.id}`))
      .send({ name: 'Mutable', chain: [randomUUID()] })
      .expect(400);
    await asAdmin(api().patch(`/api/v1/proxy-profiles/${created.body.id}`))
      .send({ name: 'Mutable', chain: [] })
      .expect(400);
    const unchanged = (await asAdmin(api().get('/api/v1/proxy-profiles'))).body.profiles.find(
      (p: { id: string }) => p.id === created.body.id,
    );
    expect(unchanged.chain.map((i: { proxy_id: string }) => i.proxy_id)).toEqual([a.id]);

    const res = await asAdmin(api().patch(`/api/v1/proxy-profiles/${created.body.id}`))
      .send({ name: 'Mutated', chain: [b.id, 'direct'] })
      .expect(200);
    expect(res.body.name).toBe('Mutated');
    expect(res.body.chain.map((i: { proxy_id: string | null }) => i.proxy_id)).toEqual([
      b.id,
      null,
    ]);
    await asAdmin(api().patch(`/api/v1/proxy-profiles/${randomUUID()}`))
      .send({ name: 'x', chain: [a.id] })
      .expect(404);
  });

  it('answers 409 to delete a profile in use, then removes it with mode=remove', async () => {
    const created = await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({ name: 'Busy', chain: [a.id] })
      .expect(201);
    await asAdmin(api().put('/api/v1/proxy-assignments/provider/api_key:busy'))
      .send({ mode: 'profile', profile_id: created.body.id })
      .expect(200);
    const res = await asAdmin(api().delete(`/api/v1/proxy-profiles/${created.body.id}`)).expect(
      409,
    );
    expect(res.body).toMatchObject({ error: 'profile_in_use' });
    expect(res.body.used_by).toEqual([
      expect.objectContaining({
        target_type: 'provider',
        target_id: 'api_key:busy',
        label: 'busy (usage-based)',
      }),
    ]);
    const done = await asAdmin(
      api().delete(`/api/v1/proxy-profiles/${created.body.id}?mode=remove`),
    ).expect(200);
    expect(done.body).toEqual({ deleted: true, affected: 1 });
    const got = await asAdmin(api().get('/api/v1/proxy-assignments/provider/api_key:busy')).expect(
      200,
    );
    expect(got.body.mode).toBe('inherit');
    await asAdmin(api().delete(`/api/v1/proxy-profiles/${created.body.id}`)).expect(404);
  });

  it('deletes an unused profile without a mode and keeps its servers', async () => {
    const created = await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({ name: 'Lonely', chain: [a.id] })
      .expect(201);
    await asAdmin(api().delete(`/api/v1/proxy-profiles/${created.body.id}`)).expect(200);
    await asAdmin(api().get(`/api/v1/proxy-servers/${a.id}`)).expect(200);
  });
});

describe('proxy assignments', () => {
  let profileA: string;
  let profileB: string;
  let serverId: string;
  const CONN = `px-conn-${randomUUID().slice(0, 6)}`;
  const CONN_SUB = `px-sub-${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    serverId = (await createServerAs(asAdmin, { name: 'Assign S' })).id;
    profileA = (
      await asAdmin(api().post('/api/v1/proxy-profiles'))
        .send({ name: 'Assign A', chain: [serverId] })
        .expect(201)
    ).body.id;
    profileB = (
      await asAdmin(api().post('/api/v1/proxy-profiles'))
        .send({ name: 'Assign B', chain: [serverId, 'direct'] })
        .expect(201)
    ).body.id;
    await ds.query(
      `INSERT INTO tenant_providers (id, tenant_id, provider, auth_type, label) VALUES
         ($1, $3, 'openai', 'api_key', 'Main'), ($2, $3, 'openai', 'subscription', 'Plus')`,
      [CONN, CONN_SUB, TEST_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO tenant_providers (id, tenant_id, provider, auth_type, label) VALUES ($1, $2, 'openai', 'api_key', 'Theirs')`,
      ['px-conn-b', ORG_B],
    );
  });

  it('answers 404 for an unknown target type and 400 for a malformed provider default', async () => {
    await asAdmin(api().get('/api/v1/proxy-assignments/nope/x')).expect(404);
    await asAdmin(api().put('/api/v1/proxy-assignments/nope/x'))
      .send({ mode: 'direct' })
      .expect(404);
    await asAdmin(api().put('/api/v1/proxy-assignments/provider/openai'))
      .send({ mode: 'direct' })
      .expect(400);
    await asAdmin(api().put('/api/v1/proxy-assignments/provider/free:openai'))
      .send({ mode: 'direct' })
      .expect(400);
  });

  it('resolves own assignment > provider default > global for a connection', async () => {
    const get = async (id: string) =>
      (await asAdmin(api().get(`/api/v1/proxy-assignments/connection/${id}`)).expect(200)).body;

    // 1. Nothing configured: global (no proxy).
    let out = await get(CONN);
    expect(out).toMatchObject({
      target_type: 'connection',
      target_id: CONN,
      mode: 'inherit',
      profile_id: null,
    });
    expect(out.inherited).toMatchObject({ target_id: 'api_key:openai', mode: 'global' });
    expect(out.effective).toMatchObject({ source: 'global', mode: 'global', chain: [] });

    // 2. Provider default (usage-based) applies to the API key connection only.
    await asAdmin(api().put('/api/v1/proxy-assignments/provider/API_KEY:OpenAI'))
      .send({ mode: 'profile', profile_id: profileA })
      .expect(200)
      .expect((r) => expect(r.body.target_id).toBe('api_key:openai'));
    out = await get(CONN);
    expect(out.mode).toBe('inherit');
    expect(out.effective).toMatchObject({
      source: 'provider',
      mode: 'profile',
      profile_id: profileA,
      profile_name: 'Assign A',
    });
    expect(out.effective.chain).toEqual([
      expect.objectContaining({ kind: 'proxy', proxy_id: serverId }),
    ]);
    const sub = await get(CONN_SUB);
    expect(sub.inherited.target_id).toBe('subscription:openai');
    expect(sub.effective).toMatchObject({ source: 'global', mode: 'global' });

    // 3. Its own assignment wins, with a Direct item in the chain.
    await asAdmin(api().put(`/api/v1/proxy-assignments/connection/${CONN}`))
      .send({ mode: 'profile', profile_id: profileB })
      .expect(200);
    out = await get(CONN);
    expect(out).toMatchObject({ mode: 'profile', profile_id: profileB });
    expect(out.effective).toMatchObject({ source: 'connection', profile_id: profileB });
    expect(out.effective.chain.map((i: { kind: string }) => i.kind)).toEqual(['proxy', 'direct']);

    // 4. Own "direct" beats the provider profile; own "global" does too.
    out = (
      await asAdmin(api().put(`/api/v1/proxy-assignments/connection/${CONN}`))
        .send({ mode: 'direct' })
        .expect(200)
    ).body;
    expect(out.effective).toEqual({ source: 'connection', mode: 'direct', chain: [] });
    out = (
      await asAdmin(api().put(`/api/v1/proxy-assignments/connection/${CONN}`))
        .send({ mode: 'global' })
        .expect(200)
    ).body;
    expect(out.effective).toMatchObject({ source: 'connection', mode: 'global' });

    // 5. Back to inherit: the provider default shows through again.
    out = (
      await asAdmin(api().put(`/api/v1/proxy-assignments/connection/${CONN}`))
        .send({ mode: 'inherit' })
        .expect(200)
    ).body;
    expect(out).toMatchObject({ mode: 'inherit' });
    expect(out.effective).toMatchObject({ source: 'provider', profile_id: profileA });
  });

  it('shows the environment global proxy (without credentials) as the effective path', async () => {
    setGlobalProxyConfigForTests(
      parseGlobalProxyEnv({ THINKER_HTTP_PROXY: 'http://gwuser:gwpass@gw.corp.example:3128' }),
    );
    try {
      const out = (
        await asAdmin(api().get(`/api/v1/proxy-assignments/connection/${CONN_SUB}`)).expect(200)
      ).body;
      expect(out.effective).toMatchObject({
        source: 'global',
        mode: 'global',
        global: 'http://gw.corp.example:3128',
      });
      expect(JSON.stringify(out)).not.toMatch(/gwuser|gwpass/);
      const servers = await asAdmin(api().get('/api/v1/proxy-servers')).expect(200);
      expect(servers.body.global.url).toBe('http://gw.corp.example:3128');
      expect(JSON.stringify(servers.body)).not.toMatch(/gwuser|gwpass/);
    } finally {
      setGlobalProxyConfigForTests(null);
    }
  });

  it('validates the mode and the profile', async () => {
    const put = (body: unknown) =>
      asAdmin(api().put(`/api/v1/proxy-assignments/connection/${CONN_SUB}`)).send(body as object);
    await put({ mode: 'proxy' }).expect(400);
    await put({ mode: 'profile' }).expect(400);
    await put({ mode: 'profile', profile_id: randomUUID() }).expect(404);
    // A profile of another workspace is "not found", not usable.
    const theirs = (await asB(api().post('/api/v1/proxy-servers')).send(server()).expect(201)).body
      .id;
    const theirProfile = (
      await asB(api().post('/api/v1/proxy-profiles'))
        .send({ name: 'Theirs', chain: [theirs] })
        .expect(201)
    ).body.id;
    await put({ mode: 'profile', profile_id: theirProfile }).expect(404);
    expect(
      (await asAdmin(api().get(`/api/v1/proxy-assignments/connection/${CONN_SUB}`))).body.mode,
    ).toBe('inherit');
  });

  it('only accepts connections of the workspace', async () => {
    await asAdmin(api().put('/api/v1/proxy-assignments/connection/px-conn-b'))
      .send({ mode: 'direct' })
      .expect(404);
    await asAdmin(api().get('/api/v1/proxy-assignments/connection/px-conn-b').expect(404));
    await asAdmin(api().put(`/api/v1/proxy-assignments/connection/${randomUUID()}`))
      .send({ mode: 'direct' })
      .expect(404);
    const rows = await ds.query(`SELECT 1 FROM proxy_assignments WHERE target_id = 'px-conn-b'`);
    expect(rows).toEqual([]);
  });

  it('lists the workspace assignments, filtered by type, with the custom providers', async () => {
    await ds.query(
      `INSERT INTO custom_providers (id, tenant_id, name, base_url, models, local_type) VALUES ('px-cp1', $1, 'My Ollama', 'http://10.1.1.1:11434', '[]', 'ollama')`,
      [TEST_TENANT_ID],
    );
    await asAdmin(api().put(`/api/v1/proxy-assignments/connection/${CONN}`))
      .send({ mode: 'direct' })
      .expect(200);
    const all = (await asAdmin(api().get('/api/v1/proxy-assignments')).expect(200)).body;
    expect(all.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_type: 'provider',
          target_id: 'api_key:openai',
          mode: 'profile',
          profile_name: 'Assign A',
        }),
        expect.objectContaining({ target_type: 'connection', target_id: CONN, mode: 'direct' }),
      ]),
    );
    expect(all.custom_providers).toEqual([
      { id: 'custom:px-cp1', name: 'My Ollama', local_type: 'ollama' },
    ]);
    const onlyConn = (
      await asAdmin(api().get('/api/v1/proxy-assignments?target_type=connection')).expect(200)
    ).body;
    expect(
      onlyConn.assignments.every((a: { target_type: string }) => a.target_type === 'connection'),
    ).toBe(true);
    // The other workspace sees none of it.
    const theirs = (await asB(api().get('/api/v1/proxy-assignments')).expect(200)).body;
    expect(theirs.assignments).toEqual([]);
    expect(theirs.custom_providers).toEqual([]);
  });

  it('accepts local server defaults, e-mail configurations and webhook or Telegram triggers only', async () => {
    await asAdmin(api().put('/api/v1/proxy-assignments/provider/local:ollama'))
      .send({ mode: 'direct' })
      .expect(200);

    await ds.query(
      `INSERT INTO email_provider_configs (id, tenant_id, provider, api_key_encrypted) VALUES ('px-em', $1, 'resend', 'x'), ('px-em-b', $2, 'resend', 'x')`,
      [TEST_TENANT_ID, ORG_B],
    );
    await asAdmin(api().put('/api/v1/proxy-assignments/email_config/px-em'))
      .send({ mode: 'global' })
      .expect(200);
    await asAdmin(api().put('/api/v1/proxy-assignments/email_config/px-em-b'))
      .send({ mode: 'global' })
      .expect(404);

    await ds.query(
      `INSERT INTO triggers (id, tenant_id, name, type, config) VALUES
         ('px-hook', $1, 'px hook', 'webhook', '{"url":"https://hooks.example.test/in"}'),
         ('px-sys', $1, 'px syslog', 'syslog', '{}'),
         ('px-hook-b', $2, 'px hook b', 'webhook', '{"url":"https://other.example.test/in"}')`,
      [TEST_TENANT_ID, ORG_B],
    );
    const out = await asAdmin(api().put('/api/v1/proxy-assignments/trigger/px-hook'))
      .send({ mode: 'profile', profile_id: profileA })
      .expect(200);
    expect(out.body.effective).toMatchObject({
      source: 'trigger',
      mode: 'profile',
      profile_id: profileA,
    });
    expect(out.body.inherited).toBeUndefined();
    await asAdmin(api().put('/api/v1/proxy-assignments/trigger/px-sys'))
      .send({ mode: 'direct' })
      .expect(400);
    await asAdmin(api().put('/api/v1/proxy-assignments/trigger/px-hook-b'))
      .send({ mode: 'direct' })
      .expect(404);

    // The server detail then suggests the webhook URL as a test target and lists its users.
    const server = (await asAdmin(api().get(`/api/v1/proxy-servers/${serverId}`)).expect(200)).body;
    expect(server.bindings.map((b: { target_id: string }) => b.target_id)).toEqual(
      expect.arrayContaining([profileA, profileB]),
    );
    const used = (
      await asAdmin(api().get('/api/v1/proxy-profiles')).expect(200)
    ).body.profiles.find((p: { id: string }) => p.id === profileA);
    expect(used.used_by).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target_type: 'trigger', target_id: 'px-hook', label: 'px hook' }),
      ]),
    );
  });

  it('refuses a numeric mode instead of resetting the assignment', async () => {
    await asAdmin(api().put(`/api/v1/proxy-assignments/connection/${CONN}`))
      .send({ mode: 'direct' })
      .expect(200);
    await asAdmin(api().put(`/api/v1/proxy-assignments/connection/${CONN}`))
      .send({ mode: 5 })
      .expect(400);
    expect(
      (await asAdmin(api().get(`/api/v1/proxy-assignments/connection/${CONN}`))).body.mode,
    ).toBe('direct');
  });
});

describe('testing a server (loopback only)', () => {
  it('rejects a missing or non-http URL', async () => {
    const s = await createServerAs(asAdmin, { host: '127.0.0.1', port: loop.port });
    for (const body of [{}, { url: '' }, { url: '/relative' }, { url: 'ftp://x.example/' }]) {
      await asAdmin(api().post(`/api/v1/proxy-servers/${s.id}/test`))
        .send(body)
        .expect(400);
    }
  });

  it('tunnels through the proxy with the stored (decrypted) credentials and records the use', async () => {
    loop.creds = `carol:${PASSWORD}`;
    loop.connects.length = 0;
    const s = await createServerAs(asAdmin, {
      host: '127.0.0.1',
      port: loop.port,
      username: 'carol',
      password: PASSWORD,
    });
    const res = await asAdmin(api().post(`/api/v1/proxy-servers/${s.id}/test`))
      .send({ url: targetUrl })
      .expect(201);
    expect(res.body).toMatchObject({ ok: true, result: 'ok', status: 200, error: null });
    expect(res.body.tunnel_ms).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    expect(loop.connects).toEqual([new URL(targetUrl).host]);

    // A test is always logged and counted, under the "Test" source.
    const logs = (await asAdmin(api().get(`/api/v1/proxy-servers/${s.id}/logs`)).expect(200)).body;
    expect(logs.logs).toHaveLength(1);
    expect(logs.logs[0]).toMatchObject({
      source_type: 'test',
      result: 'ok',
      status_code: 200,
      proxy_name: s.name,
    });
    expect(JSON.stringify(logs)).not.toContain(PASSWORD);
    const stats = (await asAdmin(api().get(`/api/v1/proxy-servers/${s.id}/stats`)).expect(200))
      .body;
    expect(stats.by_source).toEqual([
      expect.objectContaining({
        source_type: 'test',
        label: 'Test',
        connections: 1,
        successes: 1,
        failures: 0,
      }),
    ]);
    expect(stats.daily).toEqual([
      expect.objectContaining({ connections: 1, successes: 1, failures: 0 }),
    ]);
    const detail = (await asAdmin(api().get(`/api/v1/proxy-servers/${s.id}`)).expect(200)).body;
    expect(detail).toMatchObject({
      status: 'ok',
      stats_7d: expect.objectContaining({ connections: 1, successes: 1 }),
    });
    loop.creds = null;
  });

  it('reports a wrong password as auth_407 and counts the failure by code', async () => {
    loop.creds = 'dave:right-password';
    const s = await createServerAs(asAdmin, {
      host: '127.0.0.1',
      port: loop.port,
      username: 'dave',
      password: 'wrong-password',
    });
    const res = await asAdmin(api().post(`/api/v1/proxy-servers/${s.id}/test`))
      .send({ url: targetUrl })
      .expect(201);
    expect(res.body).toMatchObject({ ok: false, result: 'auth_407', status: 407, tunnel_ms: null });
    expect(JSON.stringify(res.body)).not.toMatch(/wrong-password|right-password/);
    const stats = (await asAdmin(api().get(`/api/v1/proxy-servers/${s.id}/stats`)).expect(200))
      .body;
    expect(stats.failures_by_code).toEqual({ auth_407: 1 });
    expect((await asAdmin(api().get(`/api/v1/proxy-servers/${s.id}`))).body.status).toBe('failing');
    const failed = (
      await asAdmin(api().get(`/api/v1/proxy-servers/${s.id}/logs?result=failure`)).expect(200)
    ).body;
    expect(failed.logs).toHaveLength(1);
    expect(failed.logs[0].result).toBe('auth_407');
    loop.creds = null;
  });

  it('reports a refused proxy, and tests a disabled one too', async () => {
    const s = await createServerAs(asAdmin, {
      host: '127.0.0.1',
      port: await closedPort(),
      enabled: false,
    });
    const res = await asAdmin(api().post(`/api/v1/proxy-servers/${s.id}/test`))
      .send({ url: targetUrl })
      .expect(201);
    expect(res.body).toMatchObject({ ok: false, result: 'refused', status: null });
    expect(res.body.error).toBeTruthy();
  });

  it('refuses a cloud metadata destination before connecting', async () => {
    loop.connects.length = 0;
    const s = await createServerAs(asAdmin, { host: '127.0.0.1', port: loop.port });
    const res = await asAdmin(api().post(`/api/v1/proxy-servers/${s.id}/test`))
      .send({ url: 'http://169.254.169.254/latest/meta-data/' })
      .expect(201);
    expect(res.body.ok).toBe(false);
    expect(loop.connects).toEqual([]);
  });
});

describe('statistics and logs', () => {
  let id: string;
  const usage = (
    proxyId: string,
    dayOffset: number,
    sourceType: string,
    sourceId: string,
    c: {
      n: number;
      ok: number;
      fail: number;
      codes?: Record<string, number>;
      tunnel?: number;
      samples?: number;
      max?: number;
      sent?: number;
      recv?: number;
      fb?: number;
    },
    tenant = TEST_TENANT_ID,
  ) =>
    ds.query(
      `INSERT INTO proxy_usage_daily (tenant_id, proxy_id, proxy_name, day, source_type, source_id, connections,
         successes, failures, failures_by_code, tunnel_ms_sum, tunnel_ms_max, tunnel_samples, bytes_sent, bytes_received, fallback_uses)
       VALUES ($1, $2, 'seed', CURRENT_DATE - $3::int, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)`,
      [
        tenant,
        proxyId,
        dayOffset,
        sourceType,
        sourceId,
        c.n,
        c.ok,
        c.fail,
        JSON.stringify(c.codes ?? {}),
        c.tunnel ?? 0,
        c.max ?? 0,
        c.samples ?? 0,
        c.sent ?? 0,
        c.recv ?? 0,
        c.fb ?? 0,
      ],
    );

  beforeAll(async () => {
    id = (await createServerAs(asAdmin, { name: 'Stats Server' })).id;
    const conn = `px-stat-conn-${randomUUID().slice(0, 6)}`;
    await ds.query(
      `INSERT INTO tenant_providers (id, tenant_id, provider, auth_type, label) VALUES ($1, $2, 'anthropic', 'api_key', 'Stat key')`,
      [conn, TEST_TENANT_ID],
    );
    await usage(id, 0, 'connection', conn, {
      n: 10,
      ok: 8,
      fail: 2,
      codes: { refused: 1, auth_407: 1 },
      tunnel: 400,
      samples: 8,
      max: 90,
      sent: 1000,
      recv: 5000,
      fb: 1,
    });
    await usage(id, 2, 'connection', conn, {
      n: 5,
      ok: 5,
      fail: 0,
      tunnel: 100,
      samples: 5,
      max: 30,
      sent: 10,
      recv: 20,
    });
    await usage(id, 2, 'trigger', 'removed-trigger', { n: 1, ok: 1, fail: 0 });
    await usage(id, 20, 'connection', conn, {
      n: 100,
      ok: 100,
      fail: 0,
      tunnel: 1000,
      samples: 100,
      max: 50,
    });
    await usage(id, 40, 'connection', conn, { n: 7, ok: 7, fail: 0 });
    // Another workspace's rows for a server with the same id must never leak in.
    await usage(id, 0, 'connection', 'foreign', { n: 999, ok: 999, fail: 0 }, ORG_B);
  });

  it('aggregates per day, per source and per failure code over the default 30 days', async () => {
    const res = await asAdmin(api().get(`/api/v1/proxy-servers/${id}/stats`)).expect(200);
    expect(res.body.days).toBe(30);
    expect(res.body.daily).toHaveLength(3);
    const today = res.body.daily[res.body.daily.length - 1];
    expect(today).toMatchObject({
      connections: 10,
      successes: 8,
      failures: 2,
      avg_tunnel_ms: 50,
      max_tunnel_ms: 90,
      bytes_sent: 1000,
      bytes_received: 5000,
      fallback_uses: 1,
    });
    expect(res.body.daily[0]).toMatchObject({ connections: 100, avg_tunnel_ms: 10 });
    const bySource = Object.fromEntries(
      res.body.by_source.map((s: { source_id: string; label: string; connections: number }) => [
        s.source_id,
        s,
      ]),
    );
    expect(Object.values(bySource).map((s) => (s as { connections: number }).connections)).toEqual([
      115, 1,
    ]);
    expect(bySource['removed-trigger']).toMatchObject({
      source_type: 'trigger',
      label: 'removed-trigger',
    });
    expect(
      (
        Object.values(bySource).find(
          (s) => (s as { label: string }).label === 'anthropic / Stat key',
        ) as { connections: number }
      ).connections,
    ).toBe(115);
    expect(res.body.failures_by_code).toEqual({ refused: 1, auth_407: 1 });
  });

  it('honors the days window and clamps it', async () => {
    const days = async (q: string) =>
      (await asAdmin(api().get(`/api/v1/proxy-servers/${id}/stats${q}`)).expect(200)).body;
    expect((await days('?days=7')).daily).toHaveLength(2);
    expect((await days('?days=1')).daily).toHaveLength(1);
    expect((await days('?days=365')).daily).toHaveLength(4);
    expect(await days('?days=0')).toMatchObject({ days: 30 });
    expect(await days('?days=-4')).toMatchObject({ days: 1 });
    expect(await days('?days=99999')).toMatchObject({ days: 365 });
    expect(await days('?days=abc')).toMatchObject({ days: 30 });
  });

  it('accepts a fractional days value', async () => {
    const res = await asAdmin(api().get(`/api/v1/proxy-servers/${id}/stats?days=2.5`)).expect(200);
    expect(Number.isInteger(res.body.days)).toBe(true);
  });

  it('feeds the 7-day figures and the status of the list and detail views', async () => {
    const list = (await asAdmin(api().get('/api/v1/proxy-servers')).expect(200)).body.proxies;
    const row = list.find((p: { id: string }) => p.id === id);
    expect(row.stats_7d).toEqual({
      connections: 16,
      successes: 14,
      failures: 2,
      avg_tunnel_ms: 38,
      bytes_sent: 1010,
      bytes_received: 5020,
    });
    expect(row.status).toBe('degraded');
    const detail = (await asAdmin(api().get(`/api/v1/proxy-servers/${id}`)).expect(200)).body;
    expect(detail.stats_7d).toEqual(row.stats_7d);
  });

  describe('logs', () => {
    beforeAll(async () => {
      for (let i = 0; i < 5; i++) {
        await ds.query(
          `INSERT INTO proxy_logs (id, tenant_id, proxy_id, proxy_name, started_at, duration_ms, source_type, source_id, destination, position, result, bytes_sent, bytes_received)
           VALUES ($1, $2, $3, 'seed', now() - ($4 || ' minutes')::interval, 5, $5, 'src', 'api.example:443', 1, $6, 3, 4)`,
          [
            randomUUID(),
            TEST_TENANT_ID,
            id,
            String(i),
            i % 2 === 0 ? 'connection' : 'trigger',
            i === 0 ? 'ok' : i === 1 ? 'refused' : 'timeout',
          ],
        );
      }
      await ds.query(
        `INSERT INTO proxy_logs (id, tenant_id, proxy_id, proxy_name, started_at, source_type, destination, result)
         VALUES ($1, $2, $3, 'foreign', now(), 'connection', 'leak:1', 'ok')`,
        [randomUUID(), ORG_B, id],
      );
    });

    it('returns the newest first, never another workspace rows, with numeric byte counts', async () => {
      const res = await asAdmin(api().get(`/api/v1/proxy-servers/${id}/logs`)).expect(200);
      expect(res.body.logs).toHaveLength(5);
      expect(res.body.logs.map((l: { destination: string }) => l.destination)).not.toContain(
        'leak:1',
      );
      const times = res.body.logs.map((l: { started_at: string }) =>
        new Date(l.started_at).getTime(),
      );
      expect([...times].sort((x, y) => y - x)).toEqual(times);
      expect(res.body.logs[0]).toMatchObject({ bytes_sent: 3, bytes_received: 4 });
      expect(res.body.next_before).toBeNull();
    });

    it('filters by result, source type and time', async () => {
      const get = async (q: string) =>
        (await asAdmin(api().get(`/api/v1/proxy-servers/${id}/logs?${q}`)).expect(200)).body.logs;
      expect(await get('result=ok')).toHaveLength(1);
      expect(await get('result=failure')).toHaveLength(4);
      expect(await get('result=refused')).toHaveLength(1);
      expect(await get('source_type=trigger')).toHaveLength(2);
      expect(
        await get(`from=${encodeURIComponent(new Date(Date.now() - 2.5 * 60_000).toISOString())}`),
      ).toHaveLength(3);
      expect(
        await get(`to=${encodeURIComponent(new Date(Date.now() - 2.5 * 60_000).toISOString())}`),
      ).toHaveLength(2);
      expect(await get("result=x'%3B DROP TABLE proxy_logs;--")).toEqual([]);
      expect(
        (await ds.query(`SELECT count(*)::int AS n FROM proxy_logs`))[0].n,
      ).toBeGreaterThanOrEqual(6);
    });

    it('paginates with limit and next_before, and rejects bad dates', async () => {
      const first = (
        await asAdmin(api().get(`/api/v1/proxy-servers/${id}/logs?limit=2`)).expect(200)
      ).body;
      expect(first.logs).toHaveLength(2);
      expect(first.next_before).toBeTruthy();
      const second = (
        await asAdmin(
          api().get(
            `/api/v1/proxy-servers/${id}/logs?limit=2&before=${encodeURIComponent(first.next_before)}`,
          ),
        ).expect(200)
      ).body;
      expect(second.logs).toHaveLength(2);
      const seen = new Set([...first.logs, ...second.logs].map((l: { id: string }) => l.id));
      expect(seen.size).toBe(4);
      await asAdmin(api().get(`/api/v1/proxy-servers/${id}/logs?from=yesterday`)).expect(400);
      await asAdmin(api().get(`/api/v1/proxy-servers/${id}/logs?before=nope`)).expect(400);
      const clamped = (
        await asAdmin(api().get(`/api/v1/proxy-servers/${id}/logs?limit=0`)).expect(200)
      ).body;
      expect(clamped.logs).toHaveLength(5);
    });
  });
});

describe('cross-organization isolation', () => {
  let mine: { id: string; name: string };
  let theirs: { id: string; name: string };
  let myProfile: string;
  let theirProfile: string;

  beforeAll(async () => {
    mine = await createServerAs(asAdmin, { name: 'Iso Mine' });
    theirs = await createServerAs(asB, { name: 'Iso Mine', username: 'eve', password: PASSWORD });
    myProfile = (
      await asAdmin(api().post('/api/v1/proxy-profiles'))
        .send({ name: 'Iso', chain: [mine.id] })
        .expect(201)
    ).body.id;
    theirProfile = (
      await asB(api().post('/api/v1/proxy-profiles'))
        .send({ name: 'Iso', chain: [theirs.id] })
        .expect(201)
    ).body.id;
  });

  it('allows the same server and profile names in two organizations', async () => {
    expect(mine.id).not.toBe(theirs.id);
    const rows = await ds.query(
      `SELECT tenant_id FROM proxy_servers WHERE id = ANY($1) ORDER BY tenant_id`,
      [[mine.id, theirs.id]],
    );
    expect(rows.map((r: { tenant_id: string }) => r.tenant_id).sort()).toEqual(
      [ORG_B, TEST_TENANT_ID].sort(),
    );
  });

  it('lists only the caller organization objects', async () => {
    const mineList = (await asAdmin(api().get('/api/v1/proxy-servers')).expect(200)).body.proxies;
    expect(mineList.map((p: { id: string }) => p.id)).toContain(mine.id);
    expect(mineList.map((p: { id: string }) => p.id)).not.toContain(theirs.id);
    const theirList = (await asB(api().get('/api/v1/proxy-servers')).expect(200)).body.proxies;
    expect(theirList.map((p: { id: string }) => p.id)).toContain(theirs.id);
    expect(theirList.map((p: { id: string }) => p.id)).not.toContain(mine.id);
    const profiles = (await asB(api().get('/api/v1/proxy-profiles')).expect(200)).body.profiles;
    expect(profiles.map((p: { id: string }) => p.id)).toContain(theirProfile);
    expect(profiles.map((p: { id: string }) => p.id)).not.toContain(myProfile);
    expect(
      (await asAdmin(api().get('/api/v1/proxy-profiles'))).body.profiles.map(
        (p: { id: string }) => p.id,
      ),
    ).not.toContain(theirProfile);
  });

  it('answers 404 to every route that names a foreign server, and changes nothing', async () => {
    const before = await ds.query(
      `SELECT name, port, password_encrypted, enabled FROM proxy_servers WHERE id = $1`,
      [theirs.id],
    );
    await asAdmin(api().get(`/api/v1/proxy-servers/${theirs.id}`)).expect(404);
    await asAdmin(api().patch(`/api/v1/proxy-servers/${theirs.id}`))
      .send({ name: 'hijack', enabled: false, password: 'x' })
      .expect(404);
    await asAdmin(api().delete(`/api/v1/proxy-servers/${theirs.id}?mode=remove`)).expect(404);
    await asAdmin(api().post(`/api/v1/proxy-servers/${theirs.id}/test`))
      .send({ url: targetUrl })
      .expect(404);
    await asAdmin(api().get(`/api/v1/proxy-servers/${theirs.id}/logs`)).expect(404);
    await asAdmin(api().get(`/api/v1/proxy-servers/${theirs.id}/stats`)).expect(404);
    expect(
      await ds.query(
        `SELECT name, port, password_encrypted, enabled FROM proxy_servers WHERE id = $1`,
        [theirs.id],
      ),
    ).toEqual(before);
  });

  it('cannot put a foreign server in a chain, nor read or alter a foreign profile', async () => {
    const res = await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({ name: 'Sneaky', chain: [theirs.id] })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/Unknown proxy/);
    await asAdmin(api().patch(`/api/v1/proxy-profiles/${theirProfile}`))
      .send({ name: 'x', chain: [mine.id] })
      .expect(404);
    await asAdmin(api().delete(`/api/v1/proxy-profiles/${theirProfile}?mode=remove`)).expect(404);
    await asAdmin(api().patch(`/api/v1/proxy-profiles/${myProfile}`))
      .send({ name: 'Iso', chain: [theirs.id] })
      .expect(400);
    expect(
      (
        await ds.query(`SELECT count(*)::int AS n FROM proxy_profiles WHERE id = $1`, [
          theirProfile,
        ])
      )[0].n,
    ).toBe(1);
  });

  it('cannot replace a removed server with a foreign one', async () => {
    const victim = await createServerAs(asAdmin, { name: 'Iso Victim' });
    await asAdmin(api().post('/api/v1/proxy-profiles'))
      .send({ name: 'Iso Victim P', chain: [victim.id] })
      .expect(201);
    await asAdmin(
      api().delete(`/api/v1/proxy-servers/${victim.id}?mode=replace&replace_with=${theirs.id}`),
    ).expect(404);
    await asAdmin(api().get(`/api/v1/proxy-servers/${victim.id}`)).expect(200);
  });

  it('keeps assignments apart, including provider defaults with the same id', async () => {
    await asAdmin(api().put('/api/v1/proxy-assignments/provider/api_key:isolated'))
      .send({ mode: 'profile', profile_id: myProfile })
      .expect(200);
    await asB(api().put('/api/v1/proxy-assignments/provider/api_key:isolated'))
      .send({ mode: 'direct' })
      .expect(200);
    const mineOut = (
      await asAdmin(api().get('/api/v1/proxy-assignments/provider/api_key:isolated')).expect(200)
    ).body;
    const theirOut = (
      await asB(api().get('/api/v1/proxy-assignments/provider/api_key:isolated')).expect(200)
    ).body;
    expect(mineOut).toMatchObject({ mode: 'profile', profile_id: myProfile });
    expect(theirOut).toMatchObject({ mode: 'direct', profile_id: null });
    await asB(api().put('/api/v1/proxy-assignments/provider/api_key:isolated'))
      .send({ mode: 'profile', profile_id: myProfile })
      .expect(404);
  });
});

describe('topology egress attribution', () => {
  const AGENT = 'px-agent-b';
  const ids = {
    s1: randomUUID(),
    s2: randomUUID(),
    pa: randomUUID(),
    pb: randomUUID(),
    cOpenai: randomUUID(),
    cAnthropic: randomUUID(),
    cOllama: randomUUID(),
    cMistral: randomUUID(),
  };

  const message = (opts: {
    conn: string;
    provider: string;
    local?: boolean;
    status?: string;
    egress?: object | null;
    hops?: object[] | null;
  }) =>
    ds.query(
      `INSERT INTO agent_messages (id, tenant_id, agent_id, agent_name, timestamp, status, model, provider, auth_type,
                                   tenant_provider_id, cost_usd, input_tokens, output_tokens, egress, egress_hops)
       VALUES ($1, $2, $3, 'px-agent-b', now(), $4, 'm', $5, $6, $7, 0.1, 10, 10, $8::jsonb, $9::jsonb)`,
      [
        randomUUID(),
        ORG_B,
        AGENT,
        opts.status ?? 'ok',
        opts.local ? 'custom:px-local' : opts.provider,
        opts.local ? 'local' : 'api_key',
        opts.conn,
        opts.egress ? JSON.stringify(opts.egress) : null,
        opts.hops ? JSON.stringify(opts.hops) : null,
      ],
    );

  beforeAll(async () => {
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
    await ds.query(
      `INSERT INTO agents (id, name, display_name, description, is_active, complexity_routing_enabled, tenant_id, created_at, updated_at)
       VALUES ($1, 'px-agent-b', 'PX Agent', 'x', true, true, $2, $3, $3)`,
      [AGENT, ORG_B, now],
    );
    await ds.query(
      `INSERT INTO proxy_servers (id, tenant_id, name, host, port, enabled) VALUES ($1, $3, 'edge-1', '10.9.0.1', 3128, true), ($2, $3, 'edge-2', '10.9.0.2', 3128, false)`,
      [ids.s1, ids.s2, ORG_B],
    );
    await ds.query(
      `INSERT INTO proxy_profiles (id, tenant_id, name) VALUES ($1, $3, 'Profile A'), ($2, $3, 'Profile B')`,
      [ids.pa, ids.pb, ORG_B],
    );
    await ds.query(
      `INSERT INTO proxy_bindings (tenant_id, target_type, target_id, position, proxy_id) VALUES
         ($1, 'profile', $2, 1, $4), ($1, 'profile', $2, 2, $5), ($1, 'profile', $2, 3, NULL), ($1, 'profile', $3, 1, $5)`,
      [ORG_B, ids.pa, ids.pb, ids.s1, ids.s2],
    );
    await ds.query(
      `INSERT INTO custom_providers (id, tenant_id, name, base_url, models, local_type) VALUES ('px-local', $1, 'Local Ollama', 'http://10.2.2.2:11434', '[]', 'ollama')`,
      [ORG_B],
    );
    await ds.query(
      `INSERT INTO tenant_providers (id, tenant_id, provider, auth_type, label) VALUES
         ($1, $5, 'openai', 'api_key', 'Main'), ($2, $5, 'anthropic', 'api_key', 'Work'),
         ($3, $5, 'custom:px-local', 'local', 'Box'), ($4, $5, 'mistral', 'api_key', 'Free')`,
      [ids.cOpenai, ids.cAnthropic, ids.cOllama, ids.cMistral, ORG_B],
    );
    await ds.query(
      `INSERT INTO proxy_assignments (tenant_id, target_type, target_id, mode, profile_id) VALUES
         ($1, 'connection', $2, 'profile', $3),
         ($1, 'provider', 'api_key:anthropic', 'direct', NULL)`,
      [ORG_B, ids.cOpenai, ids.pa],
    );

    const s1 = { kind: 'proxy', proxy_id: ids.s1, name: 'edge-1' };
    await message({ conn: ids.cOpenai, provider: 'openai', egress: s1 });
    await message({ conn: ids.cOpenai, provider: 'openai', egress: s1 });
    // Fell through: edge-1 refused, the chain's Direct item carried it.
    await message({
      conn: ids.cOpenai,
      provider: 'openai',
      egress: { kind: 'direct', proxy_id: null, name: null },
      hops: [
        { kind: 'proxy', proxy_id: ids.s1, name: 'edge-1', position: 1, result: 'refused' },
        {
          kind: 'proxy',
          proxy_id: ids.s2,
          name: 'edge-2',
          position: 2,
          result: 'skipped_disabled',
        },
        { kind: 'direct', proxy_id: null, name: 'direct', position: 3, result: 'ok' },
      ],
    });
    await message({ conn: ids.cOpenai, provider: 'openai', status: 'error', egress: s1 });
    // A legacy attempt without an egress record: falls on the first enabled server.
    await message({ conn: ids.cOpenai, provider: 'openai' });
    await message({
      conn: ids.cAnthropic,
      provider: 'anthropic',
      egress: { kind: 'direct', proxy_id: null, name: null },
    });
    await message({
      conn: ids.cAnthropic,
      provider: 'anthropic',
      egress: { kind: 'direct', proxy_id: null, name: null },
    });
    await message({ conn: ids.cOllama, provider: 'custom:px-local', local: true });
    await message({ conn: ids.cMistral, provider: 'mistral' });
  });

  afterAll(() => setGlobalProxyConfigForTests(null));

  const link = (links: Array<{ source: string; target: string }>, source: string, target: string) =>
    links.find((l) => l.source === source && l.target === target) as
      { requests: number; errors: number; kind: string } | undefined;
  const topology = async () =>
    (await asB(api().get('/api/v1/topology').query({ range: '24h' })).expect(200)).body;

  it('attributes attempts to the server, the Direct item and failed hops', async () => {
    setGlobalProxyConfigForTests(null);
    const t = await topology();
    const pa = `proxy:${ids.pa}`;
    const s1 = `server:${ids.s1}`;
    const s2 = `server:${ids.s2}`;

    expect(t.proxies.map((p: { id: string; name: string }) => [p.id, p.name])).toEqual([
      [pa, 'Profile A'],
    ]);
    expect(t.servers.map((s: { proxyId: string }) => s.proxyId).sort()).toEqual(
      [ids.s1, ids.s2].sort(),
    );
    expect(t.servers.find((s: { proxyId: string }) => s.proxyId === ids.s2)).toMatchObject({
      enabled: false,
      requests: 0,
    });

    // connection -> profile carries all five attempts of the connection.
    expect(link(t.links, `connection:${ids.cOpenai}`, pa)).toMatchObject({
      requests: 5,
      errors: 1,
      kind: 'egress',
    });
    // edge-1: 2 ok + 1 error + the legacy attempt; the refused hop is one more error.
    expect(link(t.links, pa, s1)).toMatchObject({ requests: 4, errors: 2 });
    expect(link(t.links, pa, s2)).toMatchObject({ requests: 0, errors: 0 });
    // The attempt that ended on Direct reaches the gateway, not the server.
    expect(link(t.links, pa, 'gateway')).toMatchObject({ requests: 1, errors: 0 });
    // Failed hops mark the server and its profile link, never the way out to the internet.
    expect(link(t.links, s1, 'internet')).toMatchObject({ requests: 4, errors: 1 });
    expect(link(t.links, s2, 'internet')).toMatchObject({ requests: 0 });
    expect(t.servers.find((s: { proxyId: string }) => s.proxyId === ids.s1)).toMatchObject({
      requests: 4,
      errors: 2,
    });
  });

  it('sends a direct provider default and an unassigned connection to the gateway, and local servers to the local network', async () => {
    setGlobalProxyConfigForTests(null);
    const t = await topology();
    expect(link(t.links, `connection:${ids.cAnthropic}`, 'gateway')).toMatchObject({
      requests: 2,
      kind: 'egress',
    });
    expect(link(t.links, `connection:${ids.cMistral}`, 'gateway')).toMatchObject({ requests: 1 });
    expect(link(t.links, `connection:${ids.cOllama}`, 'local')).toMatchObject({ requests: 1 });
    const gateway = t.egress.find((e: { id: string }) => e.id === 'gateway');
    expect(gateway.requests).toBe(2 + 1 + 1);
    expect(t.egress.find((e: { id: string }) => e.id === 'local')).toMatchObject({ requests: 1 });
    expect(t.proxies.find((p: { id: string }) => p.id === 'proxy:global')).toBeUndefined();
  });

  it('routes unassigned connections through the Global node when THINKER_HTTP_PROXY is set, but never local servers or "direct"', async () => {
    setGlobalProxyConfigForTests(
      parseGlobalProxyEnv({ THINKER_HTTP_PROXY: 'http://gw.corp.example:3128' }),
    );
    const t = await topology();
    expect(t.proxies.find((p: { id: string }) => p.id === 'proxy:global')).toMatchObject({
      name: 'Global',
      profileId: null,
      requests: 1,
    });
    expect(link(t.links, `connection:${ids.cMistral}`, 'proxy:global')).toMatchObject({
      requests: 1,
    });
    expect(link(t.links, 'proxy:global', 'internet')).toMatchObject({ requests: 1 });
    // "direct" and local servers ignore it.
    expect(link(t.links, `connection:${ids.cAnthropic}`, 'gateway')).toMatchObject({ requests: 2 });
    expect(link(t.links, `connection:${ids.cOllama}`, 'local')).toMatchObject({ requests: 1 });
    expect(link(t.links, `connection:${ids.cMistral}`, 'gateway')).toBeUndefined();
    // The profile path does not depend on it.
    expect(link(t.links, `connection:${ids.cOpenai}`, `proxy:${ids.pa}`)).toMatchObject({
      requests: 5,
    });
    setGlobalProxyConfigForTests(null);
  });

  it('does not show another organization its servers or profiles', async () => {
    const mineT = (await asAdmin(api().get('/api/v1/topology').query({ range: '24h' })).expect(200))
      .body;
    expect(mineT.servers.map((s: { proxyId: string }) => s.proxyId)).not.toEqual(
      expect.arrayContaining([ids.s1]),
    );
    expect(mineT.proxies.map((p: { id: string }) => p.id)).not.toContain(`proxy:${ids.pa}`);
    await asB(api().get('/api/v1/topology')).expect(200);
    await api().get('/api/v1/topology').expect(401);
  });
});
