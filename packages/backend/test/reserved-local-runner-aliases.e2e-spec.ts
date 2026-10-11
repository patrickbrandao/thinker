import { json } from 'express';
import { INestApplication } from '@nestjs/common';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import {
  API_BODY_LIMIT,
  PROXY_BODY_LIMIT,
  createProxyBodyBudgetMiddleware,
} from '../src/common/middleware/body-parser-limits';
import { ProviderModelFetcherService } from '../src/model-discovery/provider-model-fetcher.service';
import { createTestApp, TEST_API_KEY } from './helpers';
import { closeServer, serveOnLoopback } from './loopback';

type Json = Record<string, any>;

interface MockServer {
  server: Server;
  received: Array<{ url: string; body: Json | null }>;
}

/** An OpenAI-compatible server on 127.0.0.1 that answers with its own name. */
async function startServer(name: string, models: string[]): Promise<MockServer> {
  const received: MockServer['received'] = [];
  const server = await serveOnLoopback(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = raw ? (JSON.parse(raw) as Json) : null;
    received.push({ url: req.url ?? '', body });

    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id })) }));
      return;
    }
    res.end(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: body?.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: `Hello from ${name}` },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
      }),
    );
  });
  return { server, received };
}

function rootUrl(mock: MockServer): string {
  return `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
}

// Issue #101: a custom provider could take the alias `lmstudio` and publish
// the same ids as the built-in LM Studio connection.
describe('Reserved local runner aliases (e2e)', () => {
  const ENV_KEYS = ['MANIFEST_MODE', 'THINKER_LMSTUDIO_BASE_URL'];
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const agentName = 'alias-e2e';
  const headers = { 'x-api-key': TEST_API_KEY };
  let app: INestApplication;
  let native: MockServer;
  let secondBox: MockServer;
  let agentKey: string;

  const chat = (model: string) =>
    request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${agentKey}`)
      .send({ model, messages: [{ role: 'user', content: 'Hi' }] });

  const modelIds = async (): Promise<string[]> => {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${agentKey}`)
      .expect(200);
    return (res.body.data as Json[]).map((m) => m.id as string);
  };

  beforeAll(async () => {
    native = await startServer('native', ['qwen/qwen3-8b']);
    secondBox = await startServer('second-box', ['qwen/qwen3-8b', 'mistral-7b']);
    process.env['MANIFEST_MODE'] = 'selfhosted';
    process.env['THINKER_LMSTUDIO_BASE_URL'] = rootUrl(native);

    app = await createTestApp({
      configureApp: (nestApp) => {
        nestApp.use('/v1', createProxyBodyBudgetMiddleware(), json({ limit: PROXY_BODY_LIMIT }));
        nestApp.use(json({ limit: API_BODY_LIMIT }));
      },
    });
    // Real discovery, which only ever reaches the loopback mock above.
    const realFetcher = new ProviderModelFetcherService();
    const stub = app.get(ProviderModelFetcherService) as { fetch: unknown };
    stub.fetch = realFetcher.fetch.bind(realFetcher);

    const created = await request(app.getHttpServer())
      .post('/api/v1/agents')
      .set(headers)
      .send({ name: 'Alias E2E', agent_category: 'coding' })
      .expect(201);
    agentKey = created.body.apiKey;
  }, 30000);

  beforeEach(() => {
    native.received.length = 0;
    secondBox.received.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    if (native) await closeServer(native.server);
    if (secondBox) await closeServer(secondBox.server);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('new custom providers', () => {
    it.each(['lmstudio', 'llamacpp', 'ollama'])(
      'rejects %s as an explicit alias with 400',
      async (alias) => {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/routing/${agentName}/custom-providers`)
          .set(headers)
          .send({
            name: `Box for ${alias}`,
            alias,
            base_url: 'http://127.0.0.1:9/v1',
            models: [{ model_name: 'x' }],
          })
          .expect(400);
        expect(JSON.stringify(res.body)).toContain('reserved');
      },
    );

    it('gives a provider named "LMStudio" no default alias instead of lmstudio', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({
          name: 'LMStudio',
          base_url: 'http://127.0.0.1:9/v1',
          models: [{ model_name: 'x' }],
        })
        .expect(201);
      expect(res.body.alias).toBeNull();

      await request(app.getHttpServer())
        .put(`/api/v1/routing/${agentName}/custom-providers/${res.body.id}`)
        .set(headers)
        .send({ alias: 'lmstudio' })
        .expect(400);

      await request(app.getHttpServer())
        .delete(`/api/v1/routing/${agentName}/custom-providers/${res.body.id}`)
        .set(headers)
        .expect(200);
    });
  });

  describe('a custom provider for a second LM Studio next to the built-in one', () => {
    let customId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({
          name: 'LMStudio',
          base_url: `${rootUrl(secondBox)}/v1`,
          models: [{ model_name: 'qwen/qwen3-8b' }, { model_name: 'mistral-7b' }],
        })
        .expect(201);
      expect(res.body.alias).toBeNull();
      customId = res.body.id;

      await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/providers`)
        .set(headers)
        .send({ provider: 'lmstudio', authType: 'local' })
        .expect(201);
    }, 30000);

    it('lists every model id once, with the lmstudio/ prefix left to the built-in route', async () => {
      const ids = await modelIds();
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.filter((id) => id === 'lmstudio/qwen/qwen3-8b')).toHaveLength(1);
      expect(ids).toEqual(
        expect.arrayContaining([
          `custom:${customId}/qwen/qwen3-8b`,
          `custom:${customId}/mistral-7b`,
        ]),
      );
      expect(ids).not.toContain('lmstudio/mistral-7b');
    });

    it('routes lmstudio/<model> to the built-in server', async () => {
      const res = await chat('lmstudio/qwen/qwen3-8b').expect(200);
      expect(res.body.choices[0].message.content).toBe('Hello from native');
      expect(secondBox.received).toHaveLength(0);
      expect(native.received.at(-1)?.body).toMatchObject({ model: 'qwen/qwen3-8b' });
    });

    it('routes the custom provider by its internal key', async () => {
      const res = await chat(`custom:${customId}/qwen/qwen3-8b`).expect(200);
      expect(res.body.choices[0].message.content).toBe('Hello from second-box');
      expect(native.received.filter((r) => r.url === '/v1/chat/completions')).toHaveLength(0);
      expect(secondBox.received.at(-1)?.body).toMatchObject({ model: 'qwen/qwen3-8b' });
    });
  });
});
