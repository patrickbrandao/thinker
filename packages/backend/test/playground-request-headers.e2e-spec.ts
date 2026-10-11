import { INestApplication } from '@nestjs/common';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { createTestApp, TEST_API_KEY } from './helpers';
import { closeServer, serveOnLoopback } from './loopback';

type Json = Record<string, any>;

interface Received {
  url: string;
  headers: IncomingHttpHeaders;
  body: Json | null;
}

// Fake values only: the stored keys never leave the loopback mock.
const STORED_OPENAI_KEY = 'sk-test-stored-openai-kind';
const STORED_ANTHROPIC_KEY = 'sk-test-stored-anthropic-kind';

/**
 * Extra headers a Playground user tries to smuggle in. Every one must be
 * dropped server-side (issue #64), whatever its casing or padding.
 */
const BLOCKED_REQUEST_HEADERS: Record<string, string> = {
  Authorization: 'Bearer attacker-token',
  'X-API-Key': 'attacker-x-api-key',
  ' x-goog-api-key ': 'attacker-goog-key',
  'api-key': 'attacker-azure-key',
  'Proxy-Authorization': 'Basic YXR0YWNrZXI6eA==',
  Cookie: 'session=attacker',
  'OpenAI-Organization': 'org-attacker',
  'OpenAI-Project': 'proj-attacker',
  'ChatGPT-Account-Id': 'acct-attacker',
  'X-Goog-User-Project': 'attacker-project',
  'X-Amz-Target': 'AmazonCodeWhispererService.Other',
  'X-Forwarded-Host': 'attacker.example',
  'X-Thinker-Tier': 'reasoning',
  'X-Manifest-Tier': 'reasoning',
};
const BLOCKED_LOWER = Object.keys(BLOCKED_REQUEST_HEADERS).map((k) => k.trim().toLowerCase());

function sse(event: string | null, data: Json | string): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `${event ? `event: ${event}\n` : ''}data: ${payload}\n\n`;
}

/**
 * An OpenAI- and Anthropic-compatible upstream on 127.0.0.1 (ephemeral port).
 * Records every request so the test can inspect what actually hit the wire.
 */
async function startMockProvider(): Promise<{ server: Server; received: Received[] }> {
  const received: Received[] = [];
  const server = await serveOnLoopback(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = raw ? (JSON.parse(raw) as Json) : null;
    received.push({ url: req.url ?? '', headers: req.headers, body });

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse(null, { choices: [{ index: 0, delta: { content: 'hello ' } }] }));
      res.write(sse(null, { choices: [{ index: 0, delta: { content: 'openai' } }] }));
      res.write(sse(null, { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
      res.end(sse(null, '[DONE]'));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/messages') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_mock',
            type: 'message',
            role: 'assistant',
            model: body?.model ?? 'mock-model',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        }),
      );
      res.write(
        sse('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
      );
      res.write(
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'hello anthropic' },
        }),
      );
      res.write(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
      res.write(
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 2 },
        }),
      );
      res.end(sse('message_stop', { type: 'message_stop' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Unexpected ${req.method} ${req.url}` } }));
  });
  return { server, received };
}

function parsePlaygroundSse(text: string): Json[] {
  const events: Json[] = [];
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '));
    if (line) events.push(JSON.parse(line.slice(6)) as Json);
  }
  return events;
}

// Issue #64: the Playground forwards user-supplied extra headers to the
// provider. Credential, tenant-identity, gateway and transport headers must
// never reach the upstream; ordinary custom headers still must.
describe('Playground extra request headers (e2e)', () => {
  const ENV_KEYS = ['MANIFEST_MODE'];
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let app: INestApplication;
  let mock: { server: Server; received: Received[] };
  const providerIds: Record<'openai' | 'anthropic', string> = { openai: '', anthropic: '' };

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    mock = await startMockProvider();
    // Custom providers on a loopback URL are allowed only when self-hosted.
    process.env['MANIFEST_MODE'] = 'selfhosted';
    app = await createTestApp();

    const port = (mock.server.address() as AddressInfo).port;
    for (const [kind, apiKey] of [
      ['openai', STORED_OPENAI_KEY],
      ['anthropic', STORED_ANTHROPIC_KEY],
    ] as const) {
      const created = await api()
        .post('/api/v1/routing/test-agent/custom-providers')
        .set('x-api-key', TEST_API_KEY)
        .send({
          name: `Mock ${kind}`,
          base_url: `http://127.0.0.1:${port}/v1`,
          api_kind: kind,
          apiKey,
          models: [{ model_name: 'mock-model' }],
        })
        .expect(201);
      providerIds[kind] = created.body.id;
    }
  }, 30000);

  beforeEach(() => {
    mock.received.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    if (mock) await closeServer(mock.server);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  async function runPlayground(kind: 'openai' | 'anthropic'): Promise<Json[]> {
    const res = await api()
      .post('/api/v1/playground/run')
      .set('x-api-key', TEST_API_KEY)
      .send({
        agentName: 'test-agent',
        provider: `custom:${providerIds[kind]}`,
        model: `custom:${providerIds[kind]}/mock-model`,
        authType: 'api_key',
        messages: [{ role: 'user', content: 'say hi' }],
        requestHeaders: { ...BLOCKED_REQUEST_HEADERS, 'X-Custom-Trace': 'trace-123' },
      })
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (chunk: Buffer) => (data += chunk.toString()));
        r.on('end', () => cb(null, data));
      })
      .expect(201);
    return parsePlaygroundSse(res.body as string);
  }

  function expectOnlyAllowedHeaders(headers: IncomingHttpHeaders, port: number): void {
    for (const name of BLOCKED_LOWER) {
      if (name === 'authorization' || name === 'x-api-key') continue;
      expect({ name, value: headers[name] }).toEqual({ name, value: undefined });
    }
    // The upstream sees its own host, not a client-chosen one.
    expect(headers.host).toBe(`127.0.0.1:${port}`);
    // An ordinary custom header still goes through, value intact.
    expect(headers['x-custom-trace']).toBe('trace-123');
    // Nothing the client sent leaks in under any other spelling.
    expect(JSON.stringify(headers)).not.toContain('attacker');
  }

  it('sends the stored Bearer key, not the client Authorization, to an OpenAI-kind upstream', async () => {
    const events = await runPlayground('openai');
    const done = events.find((e) => e.type === 'done');
    expect(done?.content).toBe('hello openai');

    expect(mock.received).toHaveLength(1);
    const [call] = mock.received;
    expect(call.url).toBe('/v1/chat/completions');
    expect(call.body).toMatchObject({ model: 'mock-model' });
    expect(call.headers.authorization).toBe(`Bearer ${STORED_OPENAI_KEY}`);
    expect(call.headers['x-api-key']).toBeUndefined();
    expectOnlyAllowedHeaders(call.headers, (mock.server.address() as AddressInfo).port);
  });

  it('sends the stored x-api-key, not the client one, to an Anthropic-kind upstream', async () => {
    const events = await runPlayground('anthropic');
    const done = events.find((e) => e.type === 'done');
    expect(done?.content).toBe('hello anthropic');

    expect(mock.received).toHaveLength(1);
    const [call] = mock.received;
    expect(call.url).toBe('/v1/messages');
    expect(call.headers['x-api-key']).toBe(STORED_ANTHROPIC_KEY);
    expect(call.headers.authorization).toBeUndefined();
    expectOnlyAllowedHeaders(call.headers, (mock.server.address() as AddressInfo).port);
  });
});
