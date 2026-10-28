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
  expect(
    (await asA(api().get('/api/v1/search').query({ q: 'c' })).expect(200)).body.results,
  ).toEqual([]);
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

it('builds the topology with routes and the traffic of the window', async () => {
  const [agent] = await ds.query(`SELECT id FROM agents WHERE name = 'console-search-bot'`);
  const vm = randomUUID();
  await ds.query(
    `INSERT INTO virtual_models (id, tenant_id, agent_id, name, override_route, fallback_routes)
     VALUES ($1, $2, $3, 'topo-fast', $4, $5)`,
    [
      vm,
      TEST_TENANT_ID,
      agent.id,
      JSON.stringify({ provider: 'openai', authType: 'api_key', model: 'gpt-4o-mini' }),
      JSON.stringify([{ provider: 'anthropic', authType: 'api_key', model: 'claude-haiku' }]),
    ],
  );
  await ds.query(
    `INSERT INTO agent_messages (id, tenant_id, agent_id, agent_name, timestamp, status, model,
                                 provider, auth_type, virtual_model_id, cost_usd,
                                 input_tokens, output_tokens)
     VALUES ($1, $3, $4, 'console-search-bot', now(), 'ok', 'gpt-4o-mini', 'openai', 'api_key',
             $5, 0.5, 100, 50),
            ($2, $3, $4, 'console-search-bot', now() - interval '3 days', 'ok', 'gpt-4o-mini',
             'openai', 'api_key', $5, 1, 10, 10)`,
    [randomUUID(), randomUUID(), TEST_TENANT_ID, agent.id, vm],
  );

  const res = await asA(api().get('/api/v1/topology').query({ range: '24h' })).expect(200);
  const harness = `harness:${agent.id}`;
  const hub = `virtual:${vm}`;
  expect(res.body.harnesses).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: harness, requests: 1, tokens: 150 })]),
  );
  expect(res.body.hubs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: `auto:${agent.id}`, kind: 'auto' }),
      expect.objectContaining({ id: hub, kind: 'virtual', name: 'topo-fast', requests: 1 }),
    ]),
  );
  expect(res.body.links).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: harness, target: hub, kind: 'entry', requests: 1 }),
      expect.objectContaining({
        source: hub,
        target: 'provider:openai:api_key',
        kind: 'primary',
        requests: 1,
      }),
      expect.objectContaining({
        source: hub,
        target: 'provider:anthropic:api_key',
        kind: 'fallback',
        requests: 0,
      }),
    ]),
  );
  const openai = res.body.providers.find((p: { id: string }) => p.id === 'provider:openai:api_key');
  expect(openai).toMatchObject({ requests: 1, costUsd: 0.5, models: ['gpt-4o-mini'] });

  const week = await asA(api().get('/api/v1/topology').query({ range: '7d' })).expect(200);
  expect(week.body.range).toBe('7d');
  expect(week.body.hubs.find((h: { id: string }) => h.id === hub).requests).toBe(2);

  const other = await asB(api().get('/api/v1/topology')).expect(200);
  expect(other.body.harnesses.map((h: { id: string }) => h.id)).not.toContain(harness);
});
