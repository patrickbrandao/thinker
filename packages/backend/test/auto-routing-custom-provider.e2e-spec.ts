/**
 * `model: "auto"` on a fresh install whose only provider is a custom endpoint.
 *
 * Mirrors the qa-docker report: catalog sync off, a fresh agent created through
 * the API, a custom provider `mockprov` serving `mock-model` from a local mock,
 * tier overrides set through the API, then `auto` on every proxy surface.
 */
import { INestApplication } from '@nestjs/common';
import * as http from 'http';
import request from 'supertest';
import { createTestApp, TEST_API_KEY } from './helpers';

let mockServer: http.Server;
let mockPort: number;
const upstreamModels: string[] = [];

function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url?.endsWith('/models')) {
          res.end(
            JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }),
          );
          return;
        }
        const body = JSON.parse(raw || '{}') as { model?: string };
        upstreamModels.push(body.model ?? '');
        res.end(
          JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: 1,
            model: body.model,
            choices: [
              { index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
          }),
        );
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = (mockServer.address() as { port: number }).port;
      resolve();
    });
  });
}

let app: INestApplication;
let agentName: string;
let agentKey: string;
let previousCatalogSync: string | undefined;

const api = () => request(app.getHttpServer());
const dashboard = (r: request.Test) => r.set('x-api-key', TEST_API_KEY);
const harness = (r: request.Test) => r.set('Authorization', `Bearer ${agentKey}`);

beforeAll(async () => {
  previousCatalogSync = process.env['THINKER_CATALOG_SYNC'];
  process.env['THINKER_CATALOG_SYNC'] = 'false';
  await startMockServer();
  app = await createTestApp();

  const created = await dashboard(api().post('/api/v1/agents'))
    .send({ name: 'Auto Eval' })
    .expect(201);
  agentName = created.body.agent.name;
  agentKey = created.body.apiKey;

  await dashboard(api().post(`/api/v1/routing/${agentName}/custom-providers`))
    .send({
      name: 'mockprov',
      base_url: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: 'mock-key',
      models: [{ model_name: 'mock-model' }],
    })
    .expect(201);
}, 30_000);

afterAll(async () => {
  await app?.close();
  mockServer?.close();
  if (previousCatalogSync === undefined) delete process.env['THINKER_CATALOG_SYNC'];
  else process.env['THINKER_CATALOG_SYNC'] = previousCatalogSync;
});

describe('fresh install, custom provider only', () => {
  it('explicit model routes', async () => {
    const res = await harness(api().post('/v1/chat/completions'))
      .send({ model: 'mockprov/mock-model', messages: [{ role: 'user', content: 'ping' }] })
      .expect(200);
    expect(res.body.choices[0].message.content).toBe('pong');
  });

  it('auto with an empty default tier explains what is missing (M101)', async () => {
    const res = await harness(api().post('/v1/chat/completions'))
      .send({ model: 'auto', messages: [{ role: 'user', content: 'ping' }] })
      .expect(200);
    const text = res.body.choices[0].message.content as string;
    expect(text).toContain('M101');
    expect(text).toContain('"auto" uses the default tier, which has no model set.');
  });

  it('overrides on the complexity tiers alone are ignored while complexity routing is off', async () => {
    for (const tier of ['simple', 'standard', 'complex', 'reasoning']) {
      await dashboard(api().put(`/api/v1/routing/${agentName}/tiers/${tier}`))
        .send({ model: 'mockprov/mock-model' })
        .expect(200);
    }
    const res = await harness(api().post('/v1/chat/completions'))
      .send({ model: 'auto', messages: [{ role: 'user', content: 'ping' }] })
      .expect(200);
    const text = res.body.choices[0].message.content as string;
    expect(text).toContain('M101');
    expect(text).toContain('Complexity routing is off for this agent');
    expect(text).toContain('simple/standard/complex/reasoning');
  });

  it('auto routes on every surface once the default tier has a model', async () => {
    await dashboard(api().put(`/api/v1/routing/${agentName}/tiers/default`))
      .send({ model: 'mockprov/mock-model' })
      .expect(200);
    upstreamModels.length = 0;

    const chat = await harness(api().post('/v1/chat/completions'))
      .send({ model: 'auto', messages: [{ role: 'user', content: 'ping' }] })
      .expect(200);
    expect(chat.body.choices[0].message.content).toBe('pong');

    const messages = await harness(api().post('/v1/messages'))
      .send({ model: 'auto', max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] })
      .expect(200);
    expect(JSON.stringify(messages.body.content)).toContain('pong');

    const responses = await harness(api().post('/v1/responses'))
      .send({ model: 'auto', input: 'ping' })
      .expect(200);
    expect(JSON.stringify(responses.body.output)).toContain('pong');

    expect(upstreamModels).toEqual(['mock-model', 'mock-model', 'mock-model']);
  });
});
