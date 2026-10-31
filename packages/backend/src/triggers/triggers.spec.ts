import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createSocket } from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { renderTemplate } from './trigger-template';
import { normalizeTrigger, publicView } from './trigger-config';
import { deliver, formatSyslog, syslogSeverity } from './trigger-senders';

describe('renderTemplate', () => {
  const vars = { 'harness.name': 'a"b<c>', 'event.type': 'test' };

  it('escapes per channel and leaves unknown variables empty', () => {
    expect(renderTemplate('{"n":"{{harness.name}}"}', vars, 'json')).toBe('{"n":"a\\"b<c>"}');
    expect(renderTemplate('<b>{{ harness.name }}</b>', vars, 'html')).toBe(
      '<b>a&quot;b&lt;c&gt;</b>',
    );
    expect(renderTemplate('/x?n={{harness.name}}', vars, 'url')).toBe('/x?n=a%22b%3Cc%3E');
    expect(renderTemplate('[{{missing}}]', vars)).toBe('[]');
  });

  it('inserts every variable as a JSON object for {{event.json}}', () => {
    expect(JSON.parse(renderTemplate('{{event.json}}', vars, 'json'))).toEqual(vars);
  });
});

describe('normalizeTrigger', () => {
  it('requires the secrets each type needs', () => {
    const result = normalizeTrigger({
      name: 'Mail',
      type: 'email',
      config: { provider: 'resend' },
    });
    expect('errors' in result && result.errors).toContain('secrets.apiKey is required');
  });

  it('keeps stored secrets and header values on a partial update', () => {
    const created = normalizeTrigger({
      name: 'Hook',
      type: 'webhook',
      config: {
        url: 'https://example.com/hook',
        headers: [{ name: 'Authorization', value: 'Bearer secret-token' }],
      },
      secrets: { hmacSecret: 'shhh' },
    });
    if (!('value' in created)) throw new Error(created.errors.join());
    const updated = normalizeTrigger(
      { config: { headers: [{ name: 'Authorization' }, { name: 'X-Extra', value: '1' }] } },
      created.value,
    );
    if (!('value' in updated)) throw new Error(updated.errors.join());
    expect(updated.value.secrets).toEqual({
      headers: { Authorization: 'Bearer secret-token', 'X-Extra': '1' },
      hmacSecret: 'shhh',
    });
    const cleared = normalizeTrigger({ secrets: { hmacSecret: null } }, updated.value);
    expect('value' in cleared && cleared.value.secrets.hmacSecret).toBeUndefined();
    expect(
      publicView(updated.value.config, updated.value.secrets, 'webhook').config.headers,
    ).toEqual([
      { name: 'Authorization', hint: 'Bear…' },
      { name: 'X-Extra', hint: '••••' },
    ]);
  });

  it('bounds delivery properties', () => {
    const result = normalizeTrigger({
      name: 'Log',
      type: 'syslog',
      config: { host: 'logs.local' },
      max_retries: 11,
    });
    expect('errors' in result && result.errors).toContain('max_retries must be between 0 and 10');
  });
});

describe('syslog formatting', () => {
  const config = {
    facility: 'local0',
    app_name: 'thinker',
    format: 'rfc5424',
    message: '{{event.title}}',
    severities: { 'limit.block': 'crit' },
  };

  it('maps the event to its severity, honoring overrides and failed debug requests', () => {
    expect(syslogSeverity(config, 'limit.block', {})).toBe(2);
    expect(syslogSeverity(config, 'limit.alert', {})).toBe(4);
    expect(syslogSeverity(config, 'request.debug', { 'request.status': 'success' })).toBe(6);
    expect(syslogSeverity(config, 'request.debug', { 'request.status': 'failed' })).toBe(3);
  });

  it('builds RFC 5424 and RFC 3164 lines', () => {
    const now = new Date('2026-10-31T12:00:00.000Z');
    const line = formatSyslog(
      config,
      'limit.alert',
      { 'event.title': 'hi\nthere', 'harness.name': 'h"1' },
      now,
    );
    expect(line).toMatch(
      /^<132>1 2026-10-31T12:00:00\.000Z \S+ thinker \d+ limit\.alert \[thinker@32473 event="limit\.alert" harness="h\\"1"\] hi there$/,
    );
    expect(
      formatSyslog({ ...config, format: 'rfc3164' }, 'test', { 'event.title': 'x' }, now),
    ).toMatch(/^<134>Oct 31 \d\d:\d\d:\d\d \S+ thinker\[\d+\]: x$/);
  });
});

describe('deliver', () => {
  let server: Server;
  let url: string;
  let last: { headers: Record<string, unknown>; body: string; path: string };
  let status = 200;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        last = { headers: req.headers, body, path: req.url ?? '' };
        res.statusCode = status;
        res.end(status === 200 ? 'ok' : `denied ${String(req.headers['x-key'])}`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const base = {
    eventType: 'test',
    vars: { 'event.id': 'e1', 'harness.name': 'my harness' },
    timeoutMs: 2000,
    defaultFrom: 'noreply@example.com',
    fallbackRecipient: async () => null,
  };

  it('posts the rendered webhook body with headers and an HMAC signature', async () => {
    status = 200;
    const result = await deliver({
      ...base,
      type: 'webhook',
      config: {
        method: 'POST',
        url: `${url}/hook/{{harness.name}}`,
        content_type: 'application/json',
        body: '{"harness":"{{harness.name}}"}',
      },
      secrets: { headers: { Authorization: 'Bearer t' }, hmacSecret: 'k' },
    });
    expect(result).toEqual({ success: true, statusCode: 200, error: null, response: 'ok' });
    expect(last.path).toBe('/hook/my%20harness');
    expect(last.body).toBe('{"harness":"my harness"}');
    expect(last.headers.authorization).toBe('Bearer t');
    expect(last.headers['x-thinker-signature']).toBe(
      `sha256=${createHmac('sha256', 'k').update(last.body).digest('hex')}`,
    );
  });

  it('reports a non-2xx answer as a failure with the server response, secrets redacted', async () => {
    status = 500;
    const result = await deliver({
      ...base,
      type: 'webhook',
      config: { method: 'GET', url, content_type: 'application/json', body: '' },
      secrets: { headers: { 'X-Key': 'super-secret-key' } },
    });
    expect(result).toEqual({
      success: false,
      statusCode: 500,
      error: 'HTTP 500',
      response: 'denied [redacted]',
    });
  });

  it('fails an e-mail with no recipient at all without calling the provider', async () => {
    const result = await deliver({
      ...base,
      type: 'email',
      config: { provider: 'resend', to: [], subject: 's', body: 'b' },
      secrets: { apiKey: 're_x' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No recipient/);
  });

  it('sends syslog over UDP', async () => {
    const socket = createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    const received = new Promise<string>((resolve) =>
      socket.once('message', (msg) => resolve(msg.toString())),
    );
    const result = await deliver({
      ...base,
      type: 'syslog',
      config: {
        host: '127.0.0.1',
        port: (socket.address() as AddressInfo).port,
        transport: 'udp',
        format: 'rfc5424',
        facility: 'local0',
        app_name: 'thinker',
        message: 'hello {{harness.name}}',
      },
      secrets: {},
    });
    expect(result.success).toBe(true);
    expect(await received).toMatch(/hello my harness$/);
    socket.close();
  });
});
