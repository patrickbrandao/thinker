import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { isHttpTrigger, normalizeTrigger } from './trigger-config';
import {
  buildGelf,
  deliver,
  GELF_CHUNK_DATA,
  gelfChunks,
  parseRelpFrames,
  relpFrame,
} from './trigger-senders';

const base = {
  eventType: 'limit.alert',
  vars: { 'event.id': 'e1', 'event.type': 'limit.alert', 'harness.name': 'my harness' },
  timeoutMs: 2000,
  defaultFrom: 'noreply@example.com',
  fallbackRecipient: async () => null,
  secrets: {},
};

const gelfConfig = (extra: Record<string, unknown>) => ({
  transport: 'udp',
  compression: 'none',
  source: 'thinker-test',
  short_message: '{{harness.name}} alert',
  full_message: '',
  severities: {},
  ...extra,
});

describe('GELF and RELP config', () => {
  it('fills the defaults of each type', () => {
    const gelf = normalizeTrigger({ name: 'G', type: 'gelf', config: { host: 'logs.lan' } });
    expect('value' in gelf && gelf.value.config).toMatchObject({
      transport: 'udp',
      host: 'logs.lan',
      port: 12201,
      compression: 'none',
    });
    const relp = normalizeTrigger({ name: 'R', type: 'relp', config: { host: 'logs.lan' } });
    expect('value' in relp && relp.value.config).toMatchObject({
      host: 'logs.lan',
      port: 20514,
      format: 'rfc5424',
      facility: 'local0',
    });
  });

  it('wants a URL for HTTP and refuses gzip over TCP', () => {
    const http = normalizeTrigger({ name: 'G', type: 'gelf', config: { transport: 'http' } });
    expect(http).toEqual({ errors: ['config.url must be an http(s) URL'] });
    const tcp = normalizeTrigger({
      name: 'G',
      type: 'gelf',
      config: { transport: 'tcp', host: 'h', compression: 'gzip' },
    });
    expect(tcp).toEqual({ errors: ['GELF over TCP is not compressed'] });
  });

  it('sends only HTTP deliveries through the proxy chain', () => {
    expect(isHttpTrigger('webhook', {})).toBe(true);
    expect(isHttpTrigger('gelf', { transport: 'http' })).toBe(true);
    expect(isHttpTrigger('gelf', { transport: 'udp' })).toBe(false);
    expect(isHttpTrigger('relp', {})).toBe(false);
    expect(isHttpTrigger('syslog', {})).toBe(false);
  });
});

describe('buildGelf', () => {
  it('carries the level and every variable as an _extra field', () => {
    const doc = buildGelf(
      gelfConfig({ full_message: 'full {{event.id}}' }),
      'limit.alert',
      base.vars,
      new Date('2026-11-05T12:00:00.250Z'),
    );
    expect(doc).toEqual({
      version: '1.1',
      host: 'thinker-test',
      short_message: 'my harness alert',
      full_message: 'full e1',
      timestamp: 1793880000.25,
      level: 4,
      '_event.id': 'e1',
      '_event.type': 'limit.alert',
      '_harness.name': 'my harness',
    });
  });

  it('splits a large datagram into at most 128 chunks', () => {
    const chunks = gelfChunks(Buffer.alloc(GELF_CHUNK_DATA * 2 + 1));
    expect(chunks).toHaveLength(3);
    expect([...chunks[0]!.subarray(0, 2)]).toEqual([0x1e, 0x0f]);
    expect(chunks.map((c) => [c[10], c[11]])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(() => gelfChunks(Buffer.alloc(GELF_CHUNK_DATA * 129))).toThrow(/at most 128/);
  });
});

describe('GELF delivery', () => {
  it('sends one datagram over UDP', async () => {
    const socket = createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    const got = new Promise<Buffer>((resolve) => socket.once('message', resolve));
    const result = await deliver({
      ...base,
      type: 'gelf',
      config: gelfConfig({ host: '127.0.0.1', port: (socket.address() as AddressInfo).port }),
    });
    expect(result.success).toBe(true);
    expect(JSON.parse((await got).toString()).short_message).toBe('my harness alert');
    socket.close();
  });

  it('chunks a large gzip message over UDP and the pieces reassemble', async () => {
    const socket = createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    const parts: Buffer[] = [];
    const all = new Promise<void>((resolve) =>
      socket.on('message', (msg) => {
        parts.push(msg);
        if (parts.length === msg[11]) resolve();
      }),
    );
    const big = randomBytes(30_000).toString('base64');
    const result = await deliver({
      ...base,
      type: 'gelf',
      vars: { ...base.vars, 'event.message': big },
      config: gelfConfig({
        host: '127.0.0.1',
        port: (socket.address() as AddressInfo).port,
        compression: 'gzip',
        full_message: '{{event.message}}',
      }),
    });
    await all;
    expect(result.response).toMatch(/chunks/);
    const ordered = parts.sort((a, b) => a[10]! - b[10]!).map((p) => p.subarray(12));
    const doc = JSON.parse(gunzipSync(Buffer.concat(ordered)).toString());
    expect(doc.full_message).toBe(big);
    socket.close();
  });

  it('frames the message with \\0 over TCP', async () => {
    let received = Buffer.alloc(0);
    const done = new Promise<void>((resolve) => {
      const server: Server = createServer((sock) => {
        sock.on('data', (d) => (received = Buffer.concat([received, d])));
        sock.on('end', () => {
          server.close();
          resolve();
        });
      });
      server.listen(0, '127.0.0.1', () => {
        void deliver({
          ...base,
          type: 'gelf',
          config: gelfConfig({
            transport: 'tcp',
            host: '127.0.0.1',
            port: (server.address() as AddressInfo).port,
          }),
        });
      });
    });
    await done;
    expect(received.at(-1)).toBe(0);
    expect(JSON.parse(received.subarray(0, -1).toString()).host).toBe('thinker-test');
  });

  it('posts gzip JSON over HTTP', async () => {
    let body = Buffer.alloc(0);
    let encoding: string | undefined;
    const server = createHttpServer((req, res) => {
      encoding = req.headers['content-encoding'] as string | undefined;
      req.on('data', (c: Buffer) => (body = Buffer.concat([body, c])));
      req.on('end', () => {
        res.statusCode = 202;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const result = await deliver({
      ...base,
      type: 'gelf',
      config: gelfConfig({
        transport: 'http',
        compression: 'gzip',
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/gelf`,
      }),
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(result).toMatchObject({ success: true, statusCode: 202 });
    expect(encoding).toBe('gzip');
    expect(JSON.parse(gunzipSync(body).toString())['_harness.name']).toBe('my harness');
  });
});

describe('RELP', () => {
  it('builds and parses frames', () => {
    expect(relpFrame(3, 'close').toString()).toBe('3 close 0\n');
    expect(relpFrame(2, 'syslog', 'hi').toString()).toBe('2 syslog 2 hi\n');
    const { frames, rest } = parseRelpFrames(Buffer.from('1 rsp 6 200 OK\n2 rsp 6 200'));
    expect(frames).toEqual([{ txnr: 1, command: 'rsp', data: '200 OK' }]);
    expect(rest.toString()).toBe('2 rsp 6 200');
    expect(() => parseRelpFrames(Buffer.from('garbage\n'))).toThrow(/Malformed/);
  });

  /** A fake RELP server answering `syslog` with `syslogStatus`. */
  async function relpServer(syslogStatus: string) {
    const commands: Array<{ command: string; data: string }> = [];
    const server = createServer((sock: Socket) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const parsed = parseRelpFrames(buf);
        buf = Buffer.from(parsed.rest);
        for (const f of parsed.frames) {
          commands.push({ command: f.command, data: f.data });
          const answer =
            f.command === 'open'
              ? '200 OK\nrelp_version=0\nrelp_software=fake\ncommands=syslog'
              : f.command === 'syslog'
                ? syslogStatus
                : '';
          sock.write(relpFrame(f.txnr, 'rsp', answer));
          if (f.command === 'close') sock.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, commands, port: (server.address() as AddressInfo).port };
  }

  const relpConfig = (port: number) => ({
    host: '127.0.0.1',
    port,
    format: 'rfc5424',
    facility: 'local0',
    app_name: 'thinker',
    message: 'hello {{harness.name}}',
    severities: {},
  });

  it('opens, sends one syslog frame acknowledged with 200 and closes', async () => {
    const { server, commands, port } = await relpServer('200 OK');
    const result = await deliver({ ...base, type: 'relp', config: relpConfig(port) });
    server.close();
    expect(result.success).toBe(true);
    expect(result.response).toMatch(/via relp/);
    expect(commands.map((c) => c.command)).toEqual(['open', 'syslog', 'close']);
    expect(commands[0]!.data).toMatch(/commands=syslog/);
    expect(commands[1]!.data).toMatch(/^<132>1 .* hello my harness$/);
  });

  it('fails the delivery when the server refuses the message', async () => {
    const { server, port } = await relpServer('500 queue full');
    const result = await deliver({ ...base, type: 'relp', config: relpConfig(port) });
    server.close();
    expect(result).toMatchObject({
      success: false,
      statusCode: 500,
      error: 'RELP syslog refused: 500 queue full',
    });
  });

  it('fails when nothing listens', async () => {
    const { server, port } = await relpServer('200 OK');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = await deliver({ ...base, type: 'relp', config: relpConfig(port) });
    expect(result.success).toBe(false);
  });
});
