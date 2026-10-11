/**
 * The Manifest Cloud and marketing surfaces removed in #15 are gone: the
 * waitlist, the CRM metrics feed, GitHub stars, free models, the public and
 * internal error pages, and the managed Gemini Free provider. Their routes
 * answer 404 and Gemini Free can no longer be connected.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TEST_API_KEY } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

describe('removed SaaS routes', () => {
  it.each([
    ['post', '/api/v1/waitlist/pivot/claim'],
    ['post', '/api/v1/waitlist/autofix/claim'],
    ['get', '/api/v1/internal/crm-metrics'],
    ['get', '/api/v1/internal/crm-metrics/signups'],
    ['get', '/api/v1/github/stars'],
    ['get', '/api/v1/free-models'],
    ['get', '/api/v1/public/error-pages'],
    ['get', '/api/v1/public/error-pages/some-slug'],
    ['get', '/api/v1/internal/error-pages/clusters'],
    ['post', '/api/v1/internal/error-pages'],
    ['post', '/api/v1/providers/gemini-free/ensure'],
  ] as const)('%s %s answers 404', async (method, path) => {
    const res = await request(app.getHttpServer())
      [method](path)
      .set('x-api-key', TEST_API_KEY)
      .set('x-internal-secret', 'x'.repeat(40))
      .send({ email: 'someone@example.com' });

    expect(res.status).toBe(404);
  });

  it('rejects connecting the managed Gemini Free provider', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routing/test-agent/providers')
      .set('x-api-key', TEST_API_KEY)
      .send({ provider: 'gemini-free', apiKey: 'sk-virtual-key-123456' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('provider must be one of');
  });
});
