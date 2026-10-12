import dns = require('dns');
import net = require('net');
import { fetch as undiciFetch } from 'undici';
import { closeServer, serveOnLoopback } from './loopback';
import {
  allowedEndpointsFromEnv,
  connectTarget,
  formatViolations,
  installOfflineGuard,
  isAllowedConnect,
  lookupDecision,
  isLoopbackHost,
  type OfflineGuard,
} from './support/offline-guard';

// TEST-NET-3 (RFC 5737): never routed, so nothing leaves even if the guard broke.
const REMOTE_IP = '203.0.113.10';

describe('offline guard helpers', () => {
  it('recognizes loopback hosts', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '127.8.9.10',
      '::1',
      '[::1]',
      '::ffff:127.0.0.1',
    ]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of [
      'openrouter.ai',
      '10.0.0.1',
      '0.0.0.0',
      '::',
      '128.0.0.1',
      'localhost.evil.com',
    ]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it('allows only the DATABASE_URL host and port besides loopback', () => {
    expect(
      allowedEndpointsFromEnv({ DATABASE_URL: 'postgresql://u:p@Postgres-E2E:6543/db' }),
    ).toEqual([{ host: 'postgres-e2e', port: 6543 }]);
    expect(allowedEndpointsFromEnv({ DATABASE_URL: 'postgresql://u:p@db/x' })).toEqual([
      { host: 'db', port: 5432 },
    ]);
    expect(allowedEndpointsFromEnv({})).toEqual([]);
    expect(allowedEndpointsFromEnv({ DATABASE_URL: 'not a url' })).toEqual([]);

    const allowed = [{ host: 'db', port: 5432 }];
    expect(isAllowedConnect({ host: 'db', port: 5432 }, allowed)).toBe(true);
    expect(isAllowedConnect({ host: 'db', port: 443 }, allowed)).toBe(false);
    expect(isAllowedConnect({ host: 'api.openai.com', port: 443 }, allowed)).toBe(false);
    expect(isAllowedConnect({ host: '127.0.0.1', port: 443 }, allowed)).toBe(true);
    expect(isAllowedConnect({ path: '/tmp/.s.PGSQL.5432' }, allowed)).toBe(true);
    expect(isAllowedConnect({ port: 80 }, allowed)).toBe(true);

    expect(lookupDecision('db', allowed)).toBe('allow');
    expect(lookupDecision('localhost', allowed)).toBe('allow');
    expect(lookupDecision(REMOTE_IP, allowed)).toBe('allow');
    expect(lookupDecision('nothing-here.invalid', allowed)).toBe('nxdomain');
    expect(lookupDecision('models.dev', allowed)).toBe('block');
  });

  it('reads the destination from every Socket#connect calling convention', () => {
    expect(connectTarget([[{ host: 'a.example', port: '443' }, null]])).toEqual({
      host: 'a.example',
      port: 443,
    });
    expect(connectTarget([{ host: 'b.example', port: 80 }])).toEqual({
      host: 'b.example',
      port: 80,
    });
    expect(connectTarget([5432, 'db'])).toEqual({ host: 'db', port: 5432 });
    expect(connectTarget(['/var/run/x.sock'])).toEqual({ path: '/var/run/x.sock' });
    expect(connectTarget([{ path: '/var/run/y.sock' }])).toEqual({ path: '/var/run/y.sock' });
  });

  it('formats violations once per target', () => {
    const text = formatViolations([
      { kind: 'dns', target: 'openrouter.ai', stack: 'at a' },
      { kind: 'dns', target: 'openrouter.ai', stack: 'at b' },
    ]);
    expect(text).toContain('2 outbound network attempt(s)');
    expect(text.match(/dns openrouter\.ai/g)).toHaveLength(1);
  });
});

describe('installOfflineGuard', () => {
  let guard: OfflineGuard | undefined;
  const originalConnect = net.Socket.prototype.connect;
  const originalLookup = dns.lookup;
  const originalPromisesLookup = dns.promises.lookup;

  afterEach(() => {
    guard?.uninstall();
    guard = undefined;
  });

  it('blocks and records fetch to a remote address', async () => {
    guard = installOfflineGuard([]);
    const err = await fetch(`http://${REMOTE_IP}:8080/`).catch((e: unknown) => e);
    expect((err as { cause?: { code?: string } }).cause?.code).toBe('ENETUNREACH');
    expect(guard.drain().map((v) => `${v.kind} ${v.target}`)).toEqual([
      `connect ${REMOTE_IP}:8080`,
    ]);
  });

  it('blocks the undici package and raw TLS sockets too', async () => {
    guard = installOfflineGuard([]);
    await expect(undiciFetch(`https://${REMOTE_IP}:8443/`)).rejects.toThrow();
    const socket = net.connect({ host: REMOTE_IP, port: 5432 });
    const code = await new Promise((resolve) =>
      socket.once('error', (e: NodeJS.ErrnoException) => resolve(e.code)),
    );
    expect(code).toBe('ENETUNREACH');
    expect(guard.drain().map((v) => v.target)).toEqual([`${REMOTE_IP}:8443`, `${REMOTE_IP}:5432`]);
  });

  it('blocks and records DNS lookups of remote names', async () => {
    guard = installOfflineGuard([]);
    await expect(dns.promises.lookup('openrouter.ai')).rejects.toMatchObject({
      code: 'ENOTFOUND',
    });
    const code = await new Promise((resolve) => dns.lookup('models.dev', (e) => resolve(e?.code)));
    expect(code).toBe('ENOTFOUND');
    await expect(dns.promises.resolve4('raw.githubusercontent.com')).rejects.toMatchObject({
      code: 'ENOTFOUND',
    });
    expect(guard.drain().map((v) => v.target)).toEqual([
      'lookup openrouter.ai',
      'lookup models.dev',
      'resolve4 raw.githubusercontent.com',
    ]);
  });

  it('answers .invalid names locally without recording them', async () => {
    guard = installOfflineGuard([]);
    await expect(dns.promises.lookup('nothing-here.invalid')).rejects.toMatchObject({
      code: 'ENOTFOUND',
    });
    expect(guard.drain()).toEqual([]);
  });

  it('vets the addresses a hostname resolves to, whichever resolver answers', async () => {
    guard = installOfflineGuard([]);
    const server = await serveOnLoopback((_req, res) => res.end('pinned'));
    const { port } = server.address() as net.AddressInfo;
    const connectVia = (address: string) =>
      new Promise<string>((resolve) => {
        const socket = net.connect({
          host: 'pinned.thinker-e2e.example',
          port,
          lookup: ((_host: string, _opts: unknown, cb: (...a: unknown[]) => void) =>
            cb(null, [{ address, family: 4 }])) as unknown as net.LookupFunction,
        });
        socket.once('connect', () => {
          socket.destroy();
          resolve('connected');
        });
        socket.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
      });
    try {
      expect(await connectVia('127.0.0.1')).toBe('connected');
      expect(guard.drain()).toEqual([]);

      expect(await connectVia(REMOTE_IP)).toBe('ENETUNREACH');
      expect(guard.drain().map((v) => v.target)).toEqual([
        `pinned.thinker-e2e.example:${port} (${REMOTE_IP})`,
      ]);
    } finally {
      await closeServer(server);
    }
  });

  it('records a hostname connect that would need a real DNS answer', async () => {
    guard = installOfflineGuard([]);
    const err = await fetch('https://api.openai.com/v1/models').catch((e: unknown) => e);
    expect((err as { cause?: { code?: string } }).cause?.code).toBe('ENOTFOUND');
    expect(guard.drain().map((v) => `${v.kind} ${v.target}`)).toEqual([
      'dns lookup api.openai.com',
    ]);
  });

  it('lets loopback traffic through without recording it', async () => {
    guard = installOfflineGuard([]);
    const server = await serveOnLoopback((_req, res) => res.end('ok'));
    try {
      const { port } = server.address() as net.AddressInfo;
      const viaIp = await fetch(`http://127.0.0.1:${port}/`);
      expect(await viaIp.text()).toBe('ok');
      const viaName = await fetch(`http://localhost:${port}/`);
      expect(await viaName.text()).toBe('ok');
    } finally {
      await closeServer(server);
    }
    expect(guard.drain()).toEqual([]);
  });

  it('restores the original functions, also when installed twice', () => {
    installOfflineGuard([]);
    guard = installOfflineGuard([]);
    expect(net.Socket.prototype.connect).not.toBe(originalConnect);
    guard.uninstall();
    expect(net.Socket.prototype.connect).toBe(originalConnect);
    expect(dns.lookup).toBe(originalLookup);
    expect(dns.promises.lookup).toBe(originalPromisesLookup);
  });
});
