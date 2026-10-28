/**
 * Dashboard search (⌘K) and alerts bell: tenant-scoped results only.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, TEST_API_KEY, TEST_TENANT_ID } from './helpers';

let app: INestApplication;
let ds: DataSource;
const OTHER_USER = 'console-other-user';

const api = () => request(app.getHttpServer());
const asA = (r: request.Test) => r.set('x-api-key', TEST_API_KEY);
const asB = (r: request.Test) => r.set('x-api-key', TEST_API_KEY).set('x-test-user-id', OTHER_USER);

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);
  await asA(api().post('/api/v1/agents')).send({ name: 'console-search-bot' }).expect(201);
}, 60000);

afterAll(async () => {
  await app.close();
});

it('finds harnesses by part of the name, only in the active organization', async () => {
  const res = await asA(api().get('/api/v1/search').query({ q: 'search-b' })).expect(200);
  expect(res.body.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'harness',
        title: 'console-search-bot',
        href: '/harnesses/console-search-bot',
      }),
    ]),
  );
  const other = await asB(api().get('/api/v1/search').query({ q: 'search-b' })).expect(200);
  expect(other.body.results).toEqual([]);
});

it('ignores queries shorter than two characters and treats wildcards literally', async () => {
  expect((await asA(api().get('/api/v1/search').query({ q: 'c' })).expect(200)).body.results).toEqual(
    [],
  );
  expect(
    (await asA(api().get('/api/v1/search').query({ q: '%%' })).expect(200)).body.results,
  ).toEqual([]);
});

it('lists failed requests of the last 24 hours as alerts', async () => {
  const failed = randomUUID();
  const old = randomUUID();
  const ok = randomUUID();
  await ds.query(
    `INSERT INTO requests (id, tenant_id, agent_name, timestamp, status, error_message, error_http_status)
     VALUES ($1, $4, 'console-search-bot', now(), 'error', 'upstream exploded', 502),
            ($2, $4, 'console-search-bot', now() - interval '2 days', 'error', 'old', 500),
            ($3, $4, 'console-search-bot', now(), 'ok', NULL, NULL)`,
    [failed, old, ok, TEST_TENANT_ID],
  );
  const res = await asA(api().get('/api/v1/alerts')).expect(200);
  const ids = res.body.items.map((i: { id: string }) => i.id);
  expect(ids).toContain(failed);
  expect(ids).not.toContain(old);
  expect(ids).not.toContain(ok);
  expect(res.body.total).toBeGreaterThanOrEqual(1);
  expect(res.body.items.find((i: { id: string }) => i.id === failed)).toMatchObject({
    errorMessage: 'upstream exploded',
    errorHttpStatus: 502,
  });

  const other = await asB(api().get('/api/v1/alerts')).expect(200);
  expect(other.body.items.map((i: { id: string }) => i.id)).not.toContain(failed);
});
