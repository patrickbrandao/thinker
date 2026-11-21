import { createServer as createHttpServer } from 'node:http';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { withDeliveryDeadline } from './delivery-deadline';
import {
  MAX_RESPONSE_CHARS,
  deliver,
  parseRelpFrames,
  RELP_MAX_FRAME_BYTES,
} from './trigger-senders';

const base = {
  eventType: 'limit.alert',
  vars: { 'event.id': 'e1', 'event.type': 'limit.alert', 'harness.name': 'h' },
  timeoutMs: 400,
  defaultFrom: 'noreply@example.com',
  fallbackRecipient: async () => null,
  secrets: {},
};

const syslogConfig = (host: string, port = 514) => ({
  host,
  port,
  transport: 'udp',
  format: 'rfc5424',
  facility: 'local0',
  app_name: 'thinker',
  message: 'hello',
  severities: {},
});

async function listen(
  server: ReturnType<typeof createServer> | ReturnType<typeof createHttpServer>,
) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('trigger deliveries are bounded', () => {
  it('a RELP server that trickles bytes fails within the timeout, not never', async () => {
    // A valid frame header announcing 50 KB, then one byte every 100 ms: the
    // socket is never idle and the frame never completes, so only an absolute
    // deadline ends the session.
    const sockets: Socket[] = [];
    const server = createServer((sock) => {
      sockets.push(sock);
      sock.write('1 rsp 50000 ');
      const timer = setInterval(() => sock.write('x'), 100);
      sock.on('close', () => clearInterval(timer));
    });
    const port = await listen(server);
    const start = Date.now();
    const result = await deliver({
      ...base,
      type: 'relp',
      config: { ...syslogConfig('127.0.0.1', port), transport: undefined },
    });
    const elapsed = Date.now() - start;
    sockets.forEach((s) => s.destroy());
    server.close();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Timed out/);
    expect(elapsed).toBeLessThan(2000);
  });

  it('refuses a RELP frame larger than the cap', () => {
    expect(() => parseRelpFrames(Buffer.from(`1 rsp ${RELP_MAX_FRAME_BYTES + 1} x`))).toThrow(
      /too large/,
    );
  });

  it('reads only the start of a huge HTTP response', async () => {
    const server = createHttpServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('x'.repeat(5 * 1024 * 1024));
    });
    const port = await listen(server);
    const result = await deliver({
      ...base,
      type: 'webhook',
      config: { method: 'POST', url: `http://127.0.0.1:${port}/h`, body: '{}' },
      timeoutMs: 2000,
    });
    server.close();
    expect(result.success).toBe(false);
    expect((result.response ?? '').length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS + 1);
  });

  it('the worker deadline turns a delivery that never settles into a failure', async () => {
    const never = new Promise<never>(() => undefined);
    const result = await withDeliveryDeadline(never, 50);
    expect(result).toMatchObject({ success: false, statusCode: null });
    expect(result.error).toMatch(/did not finish/);
  });
});

describe('trigger destinations follow the private-URL policy', () => {
  it('a log trigger saved without the permission cannot reach loopback', async () => {
    const result = await deliver({
      ...base,
      type: 'syslog',
      config: syslogConfig('127.0.0.1'),
      allowPrivate: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private address/);
  });

  it('a RELP trigger saved without the permission cannot reach the LAN', async () => {
    const result = await deliver({
      ...base,
      type: 'relp',
      config: { ...syslogConfig('10.0.0.5', 20514), transport: undefined },
      allowPrivate: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private address/);
  });

  it('cloud metadata is refused even with the permission', async () => {
    for (const type of ['syslog', 'relp'] as const) {
      const result = await deliver({
        ...base,
        type,
        config: syslogConfig('169.254.169.254'),
        allowPrivate: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/metadata/);
    }
  });

  it('a GELF HTTP trigger saved without the permission cannot reach loopback', async () => {
    let hits = 0;
    const server = createHttpServer((_req, res) => {
      hits++;
      res.end('ok');
    });
    const port = await listen(server);
    const result = await deliver({
      ...base,
      type: 'gelf',
      config: {
        transport: 'http',
        url: `http://127.0.0.1:${port}/gelf`,
        compression: 'none',
        short_message: 'x',
        full_message: '',
        severities: {},
      },
      allowPrivate: false,
      timeoutMs: 2000,
    });
    server.close();
    expect(result.success).toBe(false);
    expect(hits).toBe(0);
  });
});
