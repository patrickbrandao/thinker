import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assertConnectableHost,
  resolveConnectableAddresses,
  ssrfSafeFetch,
  ssrfSafeLookup,
  SsrfBlockedError,
} from './ssrf-safe-fetch';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

const { lookup } = jest.requireMock('node:dns/promises') as { lookup: jest.Mock };

function runLookup(
  hostname: string,
  options: Record<string, unknown>,
): Promise<{ err: Error | null; address: unknown; family?: number }> {
  return new Promise((resolve) => {
    ssrfSafeLookup(
      hostname,
      options as never,
      ((err: Error | null, address: unknown, family?: number) =>
        resolve({ err, address, family })) as never,
    );
  });
}

describe('assertConnectableHost', () => {
  it.each([
    'metadata.google.internal',
    'METADATA.GOOGLE.INTERNAL.',
    'metadata',
    'instance-data.ec2.internal',
    '169.254.169.254',
    '169.254.170.2',
    '[fd00:ec2::254]',
    '[::ffff:169.254.169.254]',
    '[64:ff9b::a9fe:a9fe]',
  ])('refuses %s', (host) => {
    expect(() => assertConnectableHost(host)).toThrow(SsrfBlockedError);
  });

  it.each(['192.168.1.20', '127.0.0.1', '[::1]', 'host.docker.internal', 'api.example.com'])(
    'allows %s (LAN, loopback and public hosts are fine)',
    (host) => {
      expect(() => assertConnectableHost(host)).not.toThrow();
    },
  );
});

describe('resolveConnectableAddresses', () => {
  beforeEach(() => lookup.mockReset());

  it('returns the resolved addresses when none is metadata (private allowed)', async () => {
    lookup.mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
      { address: 'fd12::5', family: 6 },
    ]);
    await expect(resolveConnectableAddresses('ollama.lan')).resolves.toEqual([
      { address: '10.0.0.5', family: 4 },
      { address: 'fd12::5', family: 6 },
    ]);
    expect(lookup).toHaveBeenCalledWith('ollama.lan', { all: true, verbatim: true });
  });

  it.each([
    [[{ address: '169.254.169.254', family: 4 }]],
    [
      [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ],
    ],
    [
      [
        { address: '93.184.216.34', family: 4 },
        { address: 'fd00:ec2::254', family: 6 },
      ],
    ],
    [[{ address: '169.254.170.2', family: 4 }]],
    [[{ address: '::ffff:a9fe:a9fe', family: 6 }]],
  ])('blocks the whole connection when any answer is metadata (%j)', async (answer) => {
    lookup.mockResolvedValue(answer);
    await expect(resolveConnectableAddresses('evil.example')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('fails on a DNS error instead of letting the socket resolve again', async () => {
    lookup.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' }),
    );
    await expect(resolveConnectableAddresses('nonexistent.invalid')).rejects.toThrow(/ENOTFOUND/);
  });

  it('fails on an empty answer', async () => {
    lookup.mockResolvedValue([]);
    await expect(resolveConnectableAddresses('empty.example')).rejects.toThrow(/ENOTFOUND/);
  });

  it('accepts a non-metadata IP literal without DNS and refuses a metadata one', async () => {
    await expect(resolveConnectableAddresses('192.168.1.20')).resolves.toEqual([
      { address: '192.168.1.20', family: 4 },
    ]);
    await expect(resolveConnectableAddresses('[::1]')).resolves.toEqual([
      { address: '::1', family: 6 },
    ]);
    await expect(resolveConnectableAddresses('169.254.169.254')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses metadata hostnames without resolving them', async () => {
    await expect(resolveConnectableAddresses('metadata.google.internal')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('ssrfSafeLookup', () => {
  beforeEach(() => lookup.mockReset());

  it('answers the all-addresses form with only validated addresses', async () => {
    lookup.mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
      { address: 'fd12::5', family: 6 },
    ]);
    const { err, address } = await runLookup('ollama.lan', { all: true });
    expect(err).toBeNull();
    expect(address).toEqual([
      { address: '10.0.0.5', family: 4 },
      { address: 'fd12::5', family: 6 },
    ]);
  });

  it('answers the single-address form and honors a requested family', async () => {
    lookup.mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
      { address: 'fd12::5', family: 6 },
    ]);
    expect(await runLookup('ollama.lan', {})).toEqual({
      err: null,
      address: '10.0.0.5',
      family: 4,
    });
    expect(await runLookup('ollama.lan', { family: 6 })).toEqual({
      err: null,
      address: 'fd12::5',
      family: 6,
    });
    const missing = await runLookup('ollama.lan', { family: 'IPv6', all: true });
    expect(missing.address).toEqual([{ address: 'fd12::5', family: 6 }]);
  });

  it('errors when no address of the requested family exists', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const { err } = await runLookup('v4only.lan', { family: 6 });
    expect(err?.message).toMatch(/ENOTFOUND/);
  });

  it('propagates a metadata refusal and a DNS failure as errors', async () => {
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    expect((await runLookup('evil.example', { all: true })).err).toBeInstanceOf(SsrfBlockedError);

    lookup.mockRejectedValue(new Error('getaddrinfo ENOTFOUND evil.example'));
    expect((await runLookup('evil.example', {})).err?.message).toMatch(/ENOTFOUND/);
  });
});

describe('ssrfSafeFetch (real sockets, pinned DNS)', () => {
  let server: Server;
  let port: number;
  let requests = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      requests += 1;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    lookup.mockReset();
    requests = 0;
  });

  it('connects to the validated address the name resolved to', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const res = await ssrfSafeFetch(`http://models.lan:${port}/v1/models`, {
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(requests).toBe(1);
    expect(lookup).toHaveBeenCalledWith('models.lan', { all: true, verbatim: true });
  });

  it('refuses a name that resolves to metadata at connect time, without connecting', async () => {
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(ssrfSafeFetch(`http://rebind.example:${port}/`)).rejects.toThrow();
    expect(requests).toBe(0);
  });

  it('fails the request on a DNS failure', async () => {
    lookup.mockRejectedValue(new Error('getaddrinfo ENOTFOUND nonexistent.invalid'));
    await expect(ssrfSafeFetch(`http://nonexistent.invalid:${port}/`)).rejects.toThrow();
    expect(requests).toBe(0);
  });

  it('refuses metadata literals and names before opening a socket', async () => {
    await expect(ssrfSafeFetch('http://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(ssrfSafeFetch('http://[fd00:ec2::23]/v1/credentials')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(
      ssrfSafeFetch('http://metadata.google.internal/computeMetadata/v1/'),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(lookup).not.toHaveBeenCalled();
  });
});
