/**
 * Request reliability moved to neutral paths when Autofix left the backend
 * (#16): `/api/v1/overview/reliability/*` serves the dashboard's success rate,
 * fallback recoveries, request status series and per-harness/provider/model
 * reliability. The Autofix routes and the legacy `/overview/autofix-*` paths
 * answer 404, and the removed per-harness flag is no longer accepted.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestApp, TEST_AGENT_ID, TEST_API_KEY, TEST_TENANT_ID } from './helpers';

let app: INestApplication;

/** Local wall-clock, the way the gateway writes `timestamp` columns. */
function sqlTime(msAgo: number): string {
  const d = new Date(Date.now() - msAgo);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const HOUR = 3_600_000;
const REQUESTS = ['rel-success', 'rel-fallback', 'rel-error'];
// #68: another tenant's harness with the same name, whose rows must never be
// counted. Every assertion below is exact, so a leak changes a number.
const OTHER_TENANT = 'rel-other-tenant';
const OTHER_REQUESTS = ['rel-other-error', 'rel-other-success'];

beforeAll(async () => {
  app = await createTestApp();
  const ds = app.get(DataSource);
  const seed = async (
    id: string,
    status: string,
    attempts: Array<{ status: string; model: string; fallbackFrom?: string }>,
  ) => {
    await ds.query(
      `INSERT INTO requests (id, tenant_id, agent_id, agent_name, timestamp, status)
       VALUES ($1, $2, $3, 'test-agent', $4, $5)`,
      [id, TEST_TENANT_ID, TEST_AGENT_ID, sqlTime(HOUR), status],
    );
    for (const [index, attempt] of attempts.entries()) {
      await ds.query(
        `INSERT INTO agent_messages (id, request_id, attempt_number, tenant_id, agent_id, agent_name,
           timestamp, status, provider, model, fallback_from_model, input_tokens, output_tokens)
         VALUES ($1, $2, $3, $4, $5, 'test-agent', $6, $7, 'openai', $8, $9, 1, 1)`,
        [
          `${id}-${index + 1}`,
          id,
          index + 1,
          TEST_TENANT_ID,
          TEST_AGENT_ID,
          sqlTime(HOUR - (index + 1) * 1_000),
          attempt.status,
          attempt.model,
          attempt.fallbackFrom ?? null,
        ],
      );
    }
  };
  await seed('rel-success', 'success', [{ status: 'success', model: 'rel-model-a' }]);
  await seed('rel-fallback', 'success', [
    { status: 'fallback_error', model: 'rel-model-a' },
    { status: 'success', model: 'rel-model-b', fallbackFrom: 'rel-model-a' },
  ]);
  await seed('rel-error', 'failed', [{ status: 'error', model: 'rel-model-a' }]);

  const now = new Date();
  await ds.query(
    `INSERT INTO tenants (id, name, owner_user_id, organization_name, is_active, created_at, updated_at)
     VALUES ($1, $1, 'rel-other-user', 'Other Org', true, $2, $2) ON CONFLICT (id) DO NOTHING`,
    [OTHER_TENANT, now],
  );
  for (const [index, id] of OTHER_REQUESTS.entries()) {
    const status = index === 0 ? 'failed' : 'success';
    await ds.query(
      `INSERT INTO requests (id, tenant_id, agent_id, agent_name, timestamp, status)
       VALUES ($1, $2, NULL, 'test-agent', $3, $4)`,
      [id, OTHER_TENANT, sqlTime(HOUR), status],
    );
    await ds.query(
      `INSERT INTO agent_messages (id, request_id, attempt_number, tenant_id, agent_id, agent_name,
         timestamp, status, provider, model, input_tokens, output_tokens)
       VALUES ($1, $2, 1, $3, NULL, 'test-agent', $4, $5, 'openai', 'rel-model-a', 1, 1)`,
      [`${id}-1`, id, OTHER_TENANT, sqlTime(HOUR - 1_000), index === 0 ? 'error' : 'success'],
    );
  }
});

afterAll(async () => {
  const ds = app.get(DataSource);
  await ds.query('DELETE FROM agent_messages WHERE request_id = ANY($1)', [REQUESTS]);
  await ds.query('DELETE FROM agent_messages WHERE request_id = ANY($1)', [OTHER_REQUESTS]);
  await ds.query('DELETE FROM requests WHERE id = ANY($1)', [[...REQUESTS, ...OTHER_REQUESTS]]);
  await ds.query('DELETE FROM tenants WHERE id = $1', [OTHER_TENANT]);
  await app.close();
});

const get = (path: string) => request(app.getHttpServer()).get(path).set('x-api-key', TEST_API_KEY);

describe('GET /api/v1/overview/reliability/*', () => {
  it('serves the request reliability KPIs with fallback recoveries', async () => {
    const res = await get(
      '/api/v1/overview/reliability/stats?range=24h&agent_name=test-agent',
    ).expect(200);

    expect(res.body).toEqual({
      success_rate: { value: 2 / 3, previous: 0 },
      fallback_saves: { value: 1, previous: 0 },
      total_requests: { value: 3, previous: 0 },
      errors_remaining: { value: 1, previous: 0 },
    });
  });

  it('serves the request status series with success, fallback and error only', async () => {
    const res = await get(
      '/api/v1/overview/reliability/timeseries?range=24h&by=disposition&agent_name=test-agent',
    ).expect(200);

    expect(res.body.by).toBe('disposition');
    expect(res.body.keys).toEqual(['success', 'fallback', 'error']);
    const totals = (res.body.buckets as Array<{ counts: number[] }>).reduce(
      (sum, bucket) => sum.map((value, i) => value + bucket.counts[i]!),
      [0, 0, 0],
    );
    expect(totals).toEqual([1, 1, 1]);
  });

  it('rejects the removed Autofix series dimension', async () => {
    await get('/api/v1/overview/reliability/timeseries?range=24h&by=autofix').expect(400);
  });

  it('serves per-harness, per-provider and per-model reliability', async () => {
    const agents = await get('/api/v1/overview/reliability/per-agent?range=24h').expect(200);
    expect(agents.body).toEqual(
      expect.arrayContaining([
        { agent_name: 'test-agent', requests: 3, failed: 1, fallback_saves: 1, succeeded: 2 },
      ]),
    );

    const providers = await get(
      '/api/v1/overview/reliability/per-provider?range=24h&agent_name=test-agent',
    ).expect(200);
    expect(providers.body).toEqual([
      {
        provider: 'openai',
        auth_type: 'api_key',
        key_label: 'Default',
        attempts: 4,
        failed: 2,
        succeeded: 2,
      },
    ]);

    const models = await get(
      '/api/v1/overview/reliability/per-model?range=24h&agent_name=test-agent',
    ).expect(200);
    expect(models.body).toEqual(
      expect.arrayContaining([
        { model: 'rel-model-a', attempts: 3, failed: 2, succeeded: 1 },
        { model: 'rel-model-b', attempts: 1, failed: 0, succeeded: 1 },
      ]),
    );
  });

  it("never counts another tenant's rows, even for a harness with the same name (#68)", async () => {
    const stats = await get('/api/v1/overview/reliability/stats?range=24h').expect(200);
    expect(stats.body.total_requests.value).toBe(3);
    const agents = await get('/api/v1/overview/reliability/per-agent?range=24h').expect(200);
    expect(
      (agents.body as Array<{ agent_name: string; requests: number }>).filter(
        (row) => row.agent_name === 'test-agent',
      ),
    ).toEqual([expect.objectContaining({ requests: 3 })]);
    const models = await get('/api/v1/overview/reliability/per-model?range=24h').expect(200);
    expect(models.body).toEqual(
      expect.arrayContaining([{ model: 'rel-model-a', attempts: 3, failed: 2, succeeded: 1 }]),
    );
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/overview/reliability/stats').expect(401);
  });
});

describe('removed Autofix surface', () => {
  it.each([
    ['get', '/api/v1/overview/autofix-stats'],
    ['get', '/api/v1/overview/autofix-timeseries'],
    ['get', '/api/v1/overview/autofix-per-agent'],
    ['get', '/api/v1/overview/autofix-per-provider'],
    ['get', '/api/v1/overview/autofix-per-model'],
    ['get', '/api/v1/autofix/status'],
    ['post', '/api/v1/autofix/enable-all'],
    ['get', '/api/v1/routing/test-agent/autofix'],
    ['patch', '/api/v1/routing/test-agent/autofix'],
  ] as const)('%s %s answers 404', async (method, path) => {
    const res = await request(app.getHttpServer())
      [method](path)
      .set('x-api-key', TEST_API_KEY)
      .send({ enabled: true });

    expect(res.status).toBe(404);
  });

  it('rejects the removed per-harness flag on create', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents')
      .set('x-api-key', TEST_API_KEY)
      .send({ name: 'flagged-harness', autofix_enabled: false })
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('autofix_enabled');
  });
});
