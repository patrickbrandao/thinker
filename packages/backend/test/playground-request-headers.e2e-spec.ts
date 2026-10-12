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
  'x-thinker-specificity': 'coding',
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
  let app: INestApplication;
  let mock: { server: Server; received: Received[] };
  const providerIds: Record<'openai' | 'anthropic', string> = { openai: '', anthropic: '' };

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    mock = await startMockProvider();
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
  });

  async function runPlayground(
    kind: 'openai' | 'anthropic',
    requestHeaders: Record<string, string> = {
      ...BLOCKED_REQUEST_HEADERS,
      'X-Custom-Trace': 'trace-123',
    },
  ): Promise<Json[]> {
    const res = await api()
      .post('/api/v1/playground/run')
      .set('x-api-key', TEST_API_KEY)
      .send({
        agentName: 'test-agent',
        provider: `custom:${providerIds[kind]}`,
        model: `custom:${providerIds[kind]}/mock-model`,
        authType: 'api_key',
        messages: [{ role: 'user', content: 'say hi' }],
        requestHeaders,
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

  // Issue #105: the adapter's own headers win even for a name the blocklist
  // does not cover. `anthropic-version` is set by the Anthropic-kind adapter
  // and is not blocked, so it stands in for any credential header a future
  // adapter might add without updating the list.
  it('keeps the adapter value of a non-blocklisted header it sets, in any casing', async () => {
    const events = await runPlayground('anthropic', {
      'Anthropic-Version': '2099-01-01',
      'X-Custom-Trace': 'trace-123',
    });
    expect(events.find((e) => e.type === 'done')?.content).toBe('hello anthropic');

    expect(mock.received).toHaveLength(1);
    const [call] = mock.received;
    // Not replaced, and not comma-merged with the client's copy either.
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.headers['x-api-key']).toBe(STORED_ANTHROPIC_KEY);
    expect(call.headers['x-custom-trace']).toBe('trace-123');
    expect(JSON.stringify(call.headers)).not.toContain('2099-01-01');
  });

  it('forwards sanitized anthropic-beta flags through the beta merge', async () => {
    await runPlayground('anthropic', {
      'Anthropic-Beta': 'context-management-2025-06-27, Not-A-Flag',
    });

    expect(mock.received).toHaveLength(1);
    expect(mock.received[0].headers['anthropic-beta']).toBe('context-management-2025-06-27');
  });

  it('drops values fetch would refuse and still completes the run', async () => {
    const events = await runPlayground('openai', {
      'X-Control': 'a\x01b',
      'X-Del': 'a\x7fb',
      'X-Wide': 'price \u20ac',
      'X-Emoji': 'hi \u{1F600}',
      'X-Latin1': 'caf\u00e9',
      'X-Custom-Trace': 'trace-123',
    });
    // No 502: the run streams to completion without the bad headers.
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(events.find((e) => e.type === 'done')?.content).toBe('hello openai');

    expect(mock.received).toHaveLength(1);
    const { headers } = mock.received[0];
    expect(headers['x-control']).toBeUndefined();
    expect(headers['x-del']).toBeUndefined();
    expect(headers['x-wide']).toBeUndefined();
    expect(headers['x-emoji']).toBeUndefined();
    // Latin-1 is a valid header byte; Node reads it back as latin1.
    expect(headers['x-latin1']).toBe('caf\u00e9');
    expect(headers['x-custom-trace']).toBe('trace-123');
  });

  it('does not let the client renegotiate the response format or encoding', async () => {
    const events = await runPlayground('openai', {
      Accept: 'application/x-attacker',
      'Accept-Encoding': 'x-attacker-encoding',
      'X-Custom-Trace': 'trace-123',
    });
    expect(events.find((e) => e.type === 'done')?.content).toBe('hello openai');

    expect(mock.received).toHaveLength(1);
    const { headers } = mock.received[0];
    expect(headers.accept).not.toContain('x-attacker');
    expect(headers['accept-encoding']).not.toContain('x-attacker');
    expect(headers['x-custom-trace']).toBe('trace-123');
  });
});
