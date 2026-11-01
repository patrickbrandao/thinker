import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import {
  clearProxyAgentCache,
  classifyProxyError,
  getProxyAgent,
  isProviderProxyFailedError,
  outboundFetch,
  parseGlobalProxyEnv,
  parseNoProxy,
  parseProxyUrl,
  proxyAgentCacheSize,
  runWithOutboundScope,
  setGlobalProxyConfigForTests,
  setOutboundHopSink,
  summarizeEgress,
  type EgressItem,
  type HopEvent,
  type OutboundProxy,
  type OutboundScope,
} from './outbound-proxy';

interface TestProxy {
  port: number;
  connects: string[];
  close: () => Promise<void>;
}

/** Minimal CONNECT proxy: optional Basic auth, optional fixed status. */
async function startProxy(opts: { auth?: string; status?: number } = {}): Promise<TestProxy> {
  const connects: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((_req, res) => {
    res.statusCode = 405;
    res.end();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
    connects.push(req.url ?? '');
    if (opts.auth) {
      const expected = `Basic ${Buffer.from(opts.auth).toString('base64')}`;
      if (req.headers['proxy-authorization'] !== expected) {
        client.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
        return;
      }
    }
    if (opts.status) {
      client.end(`HTTP/1.1 ${opts.status} Nope\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    const [host, port] = (req.url ?? '').split(':');
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    connects,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

let target: Server;
let targetPort: number;
let targetStatus = 200;

beforeAll(async () => {
  target = createServer((req, res) => {
    res.statusCode = targetStatus;
    res.setHeader('content-type', 'text/plain');
    res.end(`hello ${req.url}`);
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  targetPort = (target.address() as AddressInfo).port;
});

afterAll(async () => {
  await clearProxyAgentCache();
  await new Promise<void>((resolve) => target.close(() => resolve()));
});

afterEach(async () => {
  targetStatus = 200;
  setOutboundHopSink(null);
  setGlobalProxyConfigForTests(null);
  await clearProxyAgentCache();
});

let seq = 0;
function proxy(port: number, extra: Partial<OutboundProxy> = {}): OutboundProxy {
  seq++;
  return {
    id: `p${seq}`,
    name: `proxy-${seq}`,
    scheme: 'http',
    host: '127.0.0.1',
    port,
    username: null,
    password: null,
    enabled: true,
    connectTimeoutMs: 2000,
    debug: false,
    version: 'v1',
    ...extra,
  };
}

function scope(chain: EgressItem[] | null): OutboundScope {
  return {
    tenantId: 't1',
    sourceType: 'connection',
    sourceId: 'c1',
    sourceLabel: 'openai / Default',
    chain,
    hops: [],
  };
}

function url(path = '/x') {
  return `http://127.0.0.1:${targetPort}${path}`;
}

/** A port with nothing listening. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('outboundFetch through a chain', () => {
  it('goes through the first proxy and records the hop and bytes', async () => {
    const p = await startProxy();
    const events: HopEvent[] = [];
    setOutboundHopSink((e) => events.push(e));
    const s = scope([{ kind: 'proxy', proxy: proxy(p.port) }]);
    const res = await runWithOutboundScope(s, () => outboundFetch(url('/a'), { method: 'GET' }));
    expect(await res.text()).toBe('hello /a');
    expect(p.connects).toEqual([`127.0.0.1:${targetPort}`]);
    expect(s.hops).toHaveLength(1);
    expect(s.hops[0]).toMatchObject({ kind: 'proxy', result: 'ok', status: 200, position: 1 });
    expect(s.hops[0]!.tunnel_ms).not.toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]!.bytesReceived).toBe('hello /a'.length);
    expect(events[0]!.destination).toBe(`127.0.0.1:${targetPort}`);
    expect(summarizeEgress(s.hops)).toEqual({
      kind: 'proxy',
      proxy_id: s.hops[0]!.proxy_id,
      name: s.hops[0]!.name,
    });
    await p.close();
  });

  it('sends Basic credentials and fails over from 407 to the next proxy', async () => {
    const guarded = await startProxy({ auth: 'user:secret' });
    const open = await startProxy();
    const wrong = proxy(guarded.port, { username: 'user', password: 'bad' });
    const right = proxy(open.port);
    const s = scope([
      { kind: 'proxy', proxy: wrong },
      { kind: 'proxy', proxy: right },
    ]);
    const res = await runWithOutboundScope(s, () => outboundFetch(url()));
    expect(res.status).toBe(200);
    expect(s.hops.map((h) => [h.name, h.result])).toEqual([
      [wrong.name, 'auth_407'],
      [right.name, 'ok'],
    ]);

    const good = proxy(guarded.port, { username: 'user', password: 'secret' });
    const s2 = scope([{ kind: 'proxy', proxy: good }]);
    const res2 = await runWithOutboundScope(s2, () => outboundFetch(url()));
    expect(res2.status).toBe(200);
    await guarded.close();
    await open.close();
  });

  it('fails over on a refused proxy and on a non-2xx CONNECT', async () => {
    const dead = proxy(await closedPort());
    const forbidden = await startProxy({ status: 403 });
    const open = await startProxy();
    const s = scope([
      { kind: 'proxy', proxy: dead },
      { kind: 'proxy', proxy: proxy(forbidden.port) },
      { kind: 'proxy', proxy: proxy(open.port) },
    ]);
    const res = await runWithOutboundScope(s, () => outboundFetch(url()));
    expect(res.status).toBe(200);
    expect(s.hops.map((h) => h.result)).toEqual(['refused', 'connect_status', 'ok']);
    expect(s.hops[1]!.status).toBe(403);
    await forbidden.close();
    await open.close();
  });

  it('fails over on a 429 from the provider, and returns the last 429', async () => {
    const a = await startProxy();
    const b = await startProxy();
    targetStatus = 429;
    const s = scope([
      { kind: 'proxy', proxy: proxy(a.port) },
      { kind: 'proxy', proxy: proxy(b.port) },
    ]);
    const res = await runWithOutboundScope(s, () => outboundFetch(url()));
    expect(res.status).toBe(429);
    expect(s.hops.map((h) => h.result)).toEqual(['upstream_429', 'ok']);
    expect(a.connects).toHaveLength(1);
    expect(b.connects).toHaveLength(1);
    await a.close();
    await b.close();
  });

  it('does not change proxy on other provider errors', async () => {
    const a = await startProxy();
    const b = await startProxy();
    targetStatus = 401;
    const s = scope([
      { kind: 'proxy', proxy: proxy(a.port) },
      { kind: 'proxy', proxy: proxy(b.port) },
    ]);
    const res = await runWithOutboundScope(s, () => outboundFetch(url()));
    expect(res.status).toBe(401);
    expect(b.connects).toHaveLength(0);
    await a.close();
    await b.close();
  });

  it('fails closed with provider_proxy_failed when every item fails', async () => {
    const s = scope([
      { kind: 'proxy', proxy: proxy(await closedPort()) },
      { kind: 'proxy', proxy: proxy(await closedPort(), { enabled: false }) },
    ]);
    const err = await runWithOutboundScope(s, () => outboundFetch(url())).catch((e) => e);
    expect(isProviderProxyFailedError(err)).toBe(true);
    expect(s.hops.map((h) => h.result)).toEqual(['refused', 'skipped_disabled']);
  });

  it('skips a disabled proxy without logging it and uses "direct" when present', async () => {
    const events: HopEvent[] = [];
    setOutboundHopSink((e) => events.push(e));
    const s = scope([{ kind: 'proxy', proxy: proxy(1, { enabled: false }) }, { kind: 'direct' }]);
    const res = await runWithOutboundScope(s, () => outboundFetch(url()));
    expect(res.status).toBe(200);
    expect(s.hops.map((h) => [h.kind, h.result])).toEqual([
      ['proxy', 'skipped_disabled'],
      ['direct', 'ok'],
    ]);
    expect(events).toHaveLength(0);
    expect(summarizeEgress(s.hops)).toEqual({ kind: 'direct', proxy_id: null, name: null });
  });

  it('"direct" ignores the global proxy', async () => {
    setGlobalProxyConfigForTests(parseGlobalProxyEnv({ THINKER_HTTP_PROXY: 'http://127.0.0.1:1' }));
    const s = scope([{ kind: 'proxy', proxy: proxy(1, { enabled: false }) }, { kind: 'direct' }]);
    const res = await runWithOutboundScope(s, () => outboundFetch(url()));
    expect(res.status).toBe(200);
  });

  it('refuses cloud metadata destinations through a proxy', async () => {
    const p = await startProxy();
    const s = scope([{ kind: 'proxy', proxy: proxy(p.port) }]);
    await expect(
      runWithOutboundScope(s, () => outboundFetch('http://169.254.169.254/latest/meta-data')),
    ).rejects.toThrow(/metadata/);
    expect(p.connects).toHaveLength(0);
    await p.close();
  });
});

describe('global proxy', () => {
  it('routes unbound traffic through THINKER_HTTP_PROXY and honors NO_PROXY', async () => {
    const p = await startProxy({ auth: 'g:pw' });
    setGlobalProxyConfigForTests(
      parseGlobalProxyEnv({
        THINKER_HTTP_PROXY: `http://g:pw@127.0.0.1:${p.port}`,
        THINKER_NO_PROXY: 'internal.example',
      }),
    );
    // 127.0.0.1 is in the default NO_PROXY: direct.
    const direct = await outboundFetch(url());
    expect(direct.status).toBe(200);
    expect(p.connects).toHaveLength(0);

    // A name outside NO_PROXY goes through the proxy (resolved by the proxy).
    const s = scope(null);
    const res = await runWithOutboundScope(s, () =>
      outboundFetch(`http://localtest.invalid:${targetPort}/`).catch((e) => e),
    );
    expect(p.connects).toEqual([`localtest.invalid:${targetPort}`]);
    expect(res).toBeDefined();
    expect(s.hops[0]).toMatchObject({ kind: 'global' });
    await p.close();
  });

  it('fails closed when the global proxy is down', async () => {
    setGlobalProxyConfigForTests(
      parseGlobalProxyEnv({ THINKER_HTTP_PROXY: `http://127.0.0.1:${await closedPort()}` }),
    );
    const err = await outboundFetch('http://example.invalid/').catch((e) => e);
    expect(isProviderProxyFailedError(err)).toBe(true);
  });
});

describe('agent cache', () => {
  it('reuses an agent per proxy settings and replaces it when they change', () => {
    const p = proxy(3128);
    const a = getProxyAgent(p);
    expect(getProxyAgent({ ...p })).toBe(a);
    const b = getProxyAgent({ ...p, version: 'v2' });
    expect(b).not.toBe(a);
    expect(proxyAgentCacheSize()).toBe(1);
  });

  it('refuses a proxy on a cloud metadata address', () => {
    expect(() => getProxyAgent(proxy(80, { host: '169.254.169.254' }))).toThrow(/metadata/);
  });
});

describe('parsing', () => {
  it('parses proxy URLs with credentials and rejects bad values naming the variable', () => {
    expect(parseProxyUrl('http://u%40x:p%3Aw@proxy.lan:3128')).toMatchObject({
      scheme: 'http',
      host: 'proxy.lan',
      port: 3128,
      username: 'u@x',
      password: 'p:w',
    });
    expect(parseProxyUrl('https://proxy.lan')).toMatchObject({ port: 443 });
    expect(parseProxyUrl('')).toBeNull();
    expect(() => parseProxyUrl('socks5://proxy:1080')).toThrow(/THINKER_HTTP_PROXY/);
    expect(() => parseProxyUrl('proxy:3128')).toThrow(/THINKER_HTTP_PROXY/);
    expect(() => parseProxyUrl('http://proxy:3128/path')).toThrow(/THINKER_HTTP_PROXY/);
    expect(() => parseProxyUrl('http://169.254.169.254:80')).toThrow(/metadata/);
  });

  it('matches NO_PROXY hosts, suffixes, IPs and CIDRs', () => {
    const m = parseNoProxy('.corp.example, api.local:8080, 10.0.0.0/8, 192.168.1.5', [
      'localhost',
      '127.0.0.1',
      '::1',
    ]);
    expect(m.matches('localhost')).toBe(true);
    expect(m.matches('127.0.0.1')).toBe(true);
    expect(m.matches('[::1]')).toBe(true);
    expect(m.matches('a.corp.example')).toBe(true);
    expect(m.matches('corp.example')).toBe(true);
    expect(m.matches('api.local')).toBe(true);
    expect(m.matches('10.9.8.7')).toBe(true);
    expect(m.matches('192.168.1.5')).toBe(true);
    expect(m.matches('192.168.1.6')).toBe(false);
    expect(m.matches('api.openai.com')).toBe(false);
    expect(parseNoProxy('*').matches('anything')).toBe(true);
    expect(() => parseNoProxy('10.0.0.0/x')).toThrow(/THINKER_NO_PROXY/);
  });

  it('includes loopback and the local runners in the default NO_PROXY', () => {
    const config = parseGlobalProxyEnv({
      THINKER_HTTP_PROXY: 'http://proxy:3128',
      OLLAMA_HOST: 'http://ollama.lan:11434',
      THINKER_LMSTUDIO_BASE_URL: 'http://studio.lan:1234/v1',
      THINKER_LLAMACPP_BASE_URL: 'http://llama.lan:8080',
    })!;
    for (const host of ['localhost', '127.0.0.1', '::1', 'ollama.lan', 'studio.lan', 'llama.lan']) {
      expect(config.noProxy.matches(host)).toBe(true);
    }
    expect(config.display).toBe('http://proxy:3128');
  });
});

describe('classifyProxyError', () => {
  it('reads the CONNECT status from undici', () => {
    const err = new TypeError('fetch failed', {
      cause: new Error('Proxy response (407) !== 200 when HTTP Tunneling'),
    });
    expect(classifyProxyError(err)).toMatchObject({ result: 'auth_407', status: 407 });
  });

  it('treats untagged errors as destination errors', () => {
    expect(
      classifyProxyError(new TypeError('fetch failed', { cause: new Error('boom') })),
    ).toBeNull();
  });
});
