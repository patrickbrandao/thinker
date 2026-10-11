import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { LimitCheckService } from '../src/notifications/services/limit-check.service';
import { createTestApp, TEST_API_KEY } from './helpers';

let app: INestApplication;
const AGENT_NAME = 'limits-test-agent';

beforeAll(async () => {
  app = await createTestApp();

  await request(app.getHttpServer())
    .post('/api/v1/agents')
    .set('x-api-key', TEST_API_KEY)
    .send({ name: AGENT_NAME });
});

afterAll(async () => {
  await app.close();
});

describe('Limits API', () => {
  let blockRuleId: string;

  it('POST /api/v1/notifications creates a block rule', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/notifications')
      .set('x-api-key', TEST_API_KEY)
      .send({
        agent_name: AGENT_NAME,
        metric_type: 'tokens',
        threshold: 100,
        period: 'day',
        action: 'block',
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.action).toBe('block');
    expect(Number(res.body.threshold)).toBe(100);
    blockRuleId = res.body.id;
  });

  it('GET /api/v1/notifications lists both notify and block rules', async () => {
    // Create a notify rule too
    await request(app.getHttpServer())
      .post('/api/v1/notifications')
      .set('x-api-key', TEST_API_KEY)
      .send({
        agent_name: AGENT_NAME,
        metric_type: 'cost',
        threshold: 10,
        period: 'month',
        action: 'notify',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/notifications?agent_name=${AGENT_NAME}`)
      .set('x-api-key', TEST_API_KEY)
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const actions = res.body.map((r: { action: string }) => r.action);
    expect(actions).toContain('block');
    expect(actions).toContain('notify');
  });

  it('PATCH /api/v1/notifications/:id updates action field', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${blockRuleId}`)
      .set('x-api-key', TEST_API_KEY)
      .send({ action: 'notify' })
      .expect(200);

    expect(res.body.action).toBe('notify');

    // Revert to block
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${blockRuleId}`)
      .set('x-api-key', TEST_API_KEY)
      .send({ action: 'block' })
      .expect(200);
  });

  it('POST /api/v1/notifications defaults action to notify', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/notifications')
      .set('x-api-key', TEST_API_KEY)
      .send({
        agent_name: AGENT_NAME,
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
      })
      .expect(201);

    expect(res.body.action).toBe('notify');
  });

  it('POST /api/v1/notifications creates a rule with action "both"', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/notifications')
      .set('x-api-key', TEST_API_KEY)
      .send({
        agent_name: AGENT_NAME,
        metric_type: 'cost',
        threshold: 50,
        period: 'week',
        action: 'both',
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.action).toBe('both');
    expect(Number(res.body.threshold)).toBe(50);
  });

  it('GET /api/v1/routing/status returns routing status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/routing/test-agent/status')
      .set('x-api-key', TEST_API_KEY)
      .expect(200);

    expect(res.body).toHaveProperty('enabled');
    expect(typeof res.body.enabled).toBe('boolean');
  });
});

/**
 * Regression for #53: the limit window ends at "now" and is used as an
 * exclusive bound. It used to be truncated to whole seconds, so usage recorded
 * earlier in the current second was invisible to both the hard-limit check and
 * the soft-limit check. The row is written with a JS Date, which the pg driver
 * serialises in the process's local time, like the proxy recorder does.
 * Run the e2e suite under TZ=UTC and a non-UTC zone (e.g. America/Sao_Paulo).
 */
describe('Limit windows include usage recorded in the current second', () => {
  const FRESH_AGENT = 'limits-fresh-usage-agent';
  let tenantId: string;
  let agentId: string;

  beforeAll(async () => {
    const ds = app.get(DataSource);
    // Minimal Better Auth "user" table (absent in tests): resolving the alert
    // recipient joins it, and the soft-limit check counts a rule as triggered
    // only after that succeeds.
    await ds.query('CREATE TABLE IF NOT EXISTS "user" (id VARCHAR PRIMARY KEY, email VARCHAR)');
    await request(app.getHttpServer())
      .post('/api/v1/agents')
      .set('x-api-key', TEST_API_KEY)
      .send({ name: FRESH_AGENT })
      .expect(201);
    const rows = await ds.query(`SELECT id, tenant_id FROM agents WHERE name = $1`, [
      FRESH_AGENT,
    ]);
    expect(rows).toHaveLength(1);
    agentId = rows[0].id;
    tenantId = rows[0].tenant_id;
  });

  const recordUsageNow = (inputTokens: number, outputTokens: number) =>
    app.get(DataSource).query(
      `INSERT INTO agent_messages (id, tenant_id, agent_id, timestamp, status, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, agent_name, user_id)
       VALUES ($1, $2, $3, $4, 'ok', 'test-model', $5, $6, 0, 0, $7, 'test-user-001')`,
      [uuid(), tenantId, agentId, new Date(), inputTokens, outputTokens, FRESH_AGENT],
    );

  it('hard limit counts a message recorded just before the check', async () => {
    const rule = await request(app.getHttpServer())
      .post('/api/v1/notifications')
      .set('x-api-key', TEST_API_KEY)
      .send({
        agent_name: FRESH_AGENT,
        metric_type: 'tokens',
        threshold: 1,
        period: 'day',
        action: 'block',
      })
      .expect(201);

    await recordUsageNow(500, 200);
    const exceeded = await app.get(LimitCheckService).checkLimits(tenantId, FRESH_AGENT);

    expect(exceeded).not.toBeNull();
    expect(exceeded!.ruleId).toBe(rule.body.id);
    expect(exceeded!.actual).toBe(700);

    await request(app.getHttpServer())
      .delete(`/api/v1/notifications/${rule.body.id}`)
      .set('x-api-key', TEST_API_KEY)
      .expect(200);
  });

  it('soft limit check counts a message recorded just before the check', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/notifications')
      .set('x-api-key', TEST_API_KEY)
      .send({
        agent_name: FRESH_AGENT,
        metric_type: 'tokens',
        threshold: 1,
        period: 'hour',
        action: 'notify',
      })
      .expect(201);

    await recordUsageNow(10, 5);
    const res = await request(app.getHttpServer())
      .post('/api/v1/notifications/trigger-check')
      .set('x-api-key', TEST_API_KEY)
      .expect(201);

    expect(res.body.triggered).toBeGreaterThan(0);
  });
});
