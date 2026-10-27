/**
 * An organization with no harness yet connects providers through the
 * reserved Playground agent, which the provider connection endpoints accept.
 * Other agent-scoped config endpoints still reject it.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TEST_API_KEY } from './helpers';

let app: INestApplication;
const USER = 'pg-connect-user';

const api = () => request(app.getHttpServer());
const as = (r: request.Test) => r.set('x-api-key', TEST_API_KEY).set('x-test-user-id', USER);

beforeAll(async () => {
  app = await createTestApp();
}, 60000);

afterAll(async () => {
  await app.close();
});

it('connects a provider with no harness through the Playground agent', async () => {
  const agents = await as(api().get('/api/v1/agents')).expect(200);
  expect(agents.body.agents ?? agents.body).toEqual([]);

  const { name } = (await as(api().get('/api/v1/playground/agent')).expect(200)).body;
  const base = `/api/v1/routing/${encodeURIComponent(name)}`;

  await as(api().post(`${base}/providers`))
    .send({ provider: 'openai' })
    .expect(201);
  await as(api().get(`${base}/status`)).expect(200);
  const providers = await as(api().get('/api/v1/providers')).expect(200);
  expect(JSON.stringify(providers.body)).toContain('openai');

  await as(api().get(`${base}/recording`)).expect(404);
});
