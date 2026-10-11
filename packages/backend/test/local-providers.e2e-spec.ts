import { json } from 'express';
import { INestApplication } from '@nestjs/common';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  API_BODY_LIMIT,
  PROXY_BODY_LIMIT,
  createProxyBodyBudgetMiddleware,
} from '../src/common/middleware/body-parser-limits';
import { ProviderModelFetcherService } from '../src/model-discovery/provider-model-fetcher.service';
import { collectResponsesSseResponse } from '../src/routing/proxy/responses-adapter';
import { createTestApp, TEST_API_KEY } from './helpers';
import { closeServer, serveOnLoopback } from './loopback';

type Json = Record<string, any>;

interface MockServer {
  server: Server;
  received: Array<{ method: string; url: string; headers: Json; body: Json | null }>;
}

const LOCAL_MODELS: Record<'lmstudio' | 'llamacpp', string[]> = {
  // LM Studio publishes hub ids with a slash, plus any loaded embedder.
  lmstudio: ['qwen/qwen3-8b', 'text-embedding-nomic-embed-text-v1.5'],
  llamacpp: ['gemma-3-4b-it'],
};

/**
 * A minimal OpenAI-compatible local server (LM Studio / llama-server shape):
 * `GET /v1/models` and `POST /v1/chat/completions`, streaming or not. Bound
 * to 127.0.0.1 on an ephemeral port.
 */
async function startLocalServer(name: 'lmstudio' | 'llamacpp'): Promise<MockServer> {
  const received: MockServer['received'] = [];
  const server = await serveOnLoopback(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = raw ? (JSON.parse(raw) as Json) : null;
    received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });

    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: LOCAL_MODELS[name].map((id) => ({ id, object: 'model', owned_by: name })),
        }),
      );
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || !body) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Unexpected ${req.method} ${req.url}` } }));
      return;
    }

    const text = `Hello from ${name}`;
    const usage = { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 };
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: Json, finish: string | null, extra: Json = {}) =>
        `data: ${JSON.stringify({
          id: 'chatcmpl-local',
          object: 'chat.completion.chunk',
          model: body.model,
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...extra,
        })}\n\n`;
      res.write(chunk({ role: 'assistant', content: '' }, null));
      res.write(chunk({ content: 'Hello from ' }, null));
      res.write(chunk({ content: name }, null));
      res.write(chunk({}, 'stop'));
      if (body.stream_options?.include_usage) {
        res.write(
          `data: ${JSON.stringify({ id: 'chatcmpl-local', object: 'chat.completion.chunk', model: body.model, choices: [], usage })}\n\n`,
        );
      }
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-local',
        object: 'chat.completion',
        model: body.model,
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
        usage,
      }),
    );
  });
  return { server, received };
}

function baseUrl(mock: MockServer): string {
  return `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}/v1`;
}

/** Concatenate the text deltas of an OpenAI chat-completions SSE body. */
function chatStreamText(sse: string): string {
  return sse
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice('data: '.length)) as Json)
    .map((event) => event.choices?.[0]?.delta?.content ?? '')
    .join('');
}

/** Concatenate the text deltas of an Anthropic Messages SSE body. */
function anthropicStreamText(sse: string): string {
  return sse
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as Json)
    .filter((event) => event.type === 'content_block_delta')
    .map((event) => event.delta?.text ?? '')
    .join('');
}

// Issue #76: LM Studio and llama.cpp connected (201, auth_type local) but
// every chat failed with "No endpoint configured for provider".
describe('Built-in local providers: LM Studio and llama.cpp (e2e)', () => {
  const ENV_KEYS = ['MANIFEST_MODE', 'THINKER_LMSTUDIO_BASE_URL', 'THINKER_LLAMACPP_BASE_URL'];
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let app: INestApplication;
  let lmstudio: MockServer;
  let llamacpp: MockServer;
  let agentKey: string;
  let agentId: string;

  const proxy = (path: string) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${agentKey}`);

  beforeAll(async () => {
    lmstudio = await startLocalServer('lmstudio');
    llamacpp = await startLocalServer('llamacpp');
    // Built-in local providers are self-hosted only.
    process.env['MANIFEST_MODE'] = 'selfhosted';
    process.env['THINKER_LMSTUDIO_BASE_URL'] = baseUrl(lmstudio);
    process.env['THINKER_LLAMACPP_BASE_URL'] = baseUrl(llamacpp);

    app = await createTestApp({
      configureApp: (nestApp) => {
        nestApp.use('/v1', createProxyBodyBudgetMiddleware(), json({ limit: PROXY_BODY_LIMIT }));
        nestApp.use(json({ limit: API_BODY_LIMIT }));
      },
    });
    // createTestApp stubs discovery; this suite runs the real fetcher, which
    // only ever reaches the two loopback mocks above.
    const realFetcher = new ProviderModelFetcherService();
    const stub = app.get(ProviderModelFetcherService) as { fetch: unknown };
    stub.fetch = realFetcher.fetch.bind(realFetcher);

    const created = await request(app.getHttpServer())
      .post('/api/v1/agents')
      .set('x-api-key', TEST_API_KEY)
      .send({ name: 'Local E2E', agent_category: 'coding', autofix_enabled: false })
      .expect(201);
    agentKey = created.body.apiKey;
    agentId = created.body.agent.id;

    for (const provider of ['lmstudio', 'llamacpp']) {
      const connected = await request(app.getHttpServer())
        .post('/api/v1/routing/local-e2e/providers')
        .set('x-api-key', TEST_API_KEY)
        .send({ provider, authType: 'local' })
        .expect(201);
      expect(connected.body).toMatchObject({ provider, auth_type: 'local' });
    }
  }, 30000);

  beforeEach(() => {
    lmstudio.received.length = 0;
    llamacpp.received.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    if (lmstudio) await closeServer(lmstudio.server);
    if (llamacpp) await closeServer(llamacpp.server);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('discovers chat models from each server and publishes them in /v1/models', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${agentKey}`)
      .expect(200);

    const ids = (res.body.data as Json[]).map((model) => model.id);
    expect(ids).toEqual(
      expect.arrayContaining(['lmstudio/qwen/qwen3-8b', 'llamacpp/gemma-3-4b-it']),
    );
    // Embedders cannot serve chat completions and stay out of the catalog.
    expect(ids.some((id) => id.includes('embed'))).toBe(false);
  });

  it.each([
    ['lmstudio', 'lmstudio/qwen/qwen3-8b', 'qwen/qwen3-8b'],
    ['llamacpp', 'llamacpp/gemma-3-4b-it', 'gemma-3-4b-it'],
  ] as const)(
    'routes a non-streaming chat completion to %s',
    async (name, model, upstreamModel) => {
      const res = await proxy('/v1/chat/completions')
        .send({ model, messages: [{ role: 'user', content: 'Hi' }] })
        .expect(200);

      expect(res.body.choices[0].message.content).toBe(`Hello from ${name}`);
      expect(res.body.usage).toMatchObject({ prompt_tokens: 7, completion_tokens: 4 });

      const mock = name === 'lmstudio' ? lmstudio : llamacpp;
      const other = name === 'lmstudio' ? llamacpp : lmstudio;
      expect(other.received).toHaveLength(0);
      expect(mock.received).toHaveLength(1);
      const [call] = mock.received;
      expect(call.url).toBe('/v1/chat/completions');
      expect(call.headers.authorization).toBeUndefined();
      expect(call.body).toMatchObject({ model: upstreamModel });
    },
  );

  it.each([
    ['lmstudio', 'lmstudio/qwen/qwen3-8b'],
    ['llamacpp', 'llamacpp/gemma-3-4b-it'],
  ] as const)('streams a chat completion from %s as OpenAI SSE', async (name, model) => {
    const res = await proxy('/v1/chat/completions')
      .send({ model, stream: true, messages: [{ role: 'user', content: 'Hi' }] })
      .expect(200);

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(chatStreamText(res.text)).toBe(`Hello from ${name}`);
    expect(res.text.trimEnd().endsWith('data: [DONE]')).toBe(true);

    const mock = name === 'lmstudio' ? lmstudio : llamacpp;
    expect(mock.received).toHaveLength(1);
    expect(mock.received[0].body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it.each([false, true])(
    'serves Anthropic Messages clients from LM Studio (stream=%s)',
    async (stream) => {
      const res = await proxy('/v1/messages')
        .set('anthropic-version', '2023-06-01')
        .send({
          model: 'lmstudio/qwen/qwen3-8b',
          max_tokens: 64,
          stream,
          messages: [{ role: 'user', content: 'Hi' }],
        })
        .expect(200);

      if (stream) {
        expect(res.text).toContain('event: message_start');
        expect(anthropicStreamText(res.text)).toBe('Hello from lmstudio');
      } else {
        expect(res.body).toMatchObject({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello from lmstudio' }],
        });
      }
      expect(lmstudio.received).toHaveLength(1);
      expect(lmstudio.received[0].url).toBe('/v1/chat/completions');
      expect(lmstudio.received[0].body).toMatchObject({ model: 'qwen/qwen3-8b' });
    },
  );

  it.each([false, true])(
    'serves Responses API clients from llama.cpp (stream=%s)',
    async (stream) => {
      const res = await proxy('/v1/responses')
        .send({ model: 'llamacpp/gemma-3-4b-it', input: 'Hi', stream })
        .expect(200);

      const body = stream ? collectResponsesSseResponse(res.text) : res.body;
      expect(body.output).toEqual([
        expect.objectContaining({
          type: 'message',
          content: [expect.objectContaining({ type: 'output_text', text: 'Hello from llamacpp' })],
        }),
      ]);
      expect(llamacpp.received).toHaveLength(1);
      expect(llamacpp.received[0].url).toBe('/v1/chat/completions');
      expect(llamacpp.received[0].body).toMatchObject({ model: 'gemma-3-4b-it' });
    },
  );

  it('logs local requests under the canonical provider at zero cost', async () => {
    await proxy('/v1/chat/completions')
      .send({ model: 'llamacpp/gemma-3-4b-it', messages: [{ role: 'user', content: 'Hi' }] })
      .expect(200);

    const ds = app.get(DataSource);
    let rows: Json[] = [];
    for (let i = 0; i < 50 && rows.length === 0; i++) {
      rows = await ds.query(
        `SELECT provider, model, cost_usd, input_tokens, output_tokens
           FROM agent_messages WHERE agent_id = $1 AND provider = 'llamacpp'`,
        [agentId],
      );
      if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ provider: 'llamacpp', input_tokens: 7, output_tokens: 4 });
    expect(Number(rows[0].cost_usd ?? 0)).toBe(0);
  });
});
