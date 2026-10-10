/**
 * The proxy hot path has no plan paywall (#14). Even with the variables that
 * used to switch the Free-plan request limit on (Stripe keys plus a zero
 * request allowance), every request is routed to the provider, and a 402 from
 * the provider is forwarded as a provider error, never turned into a plan
 * block.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  createTestApp,
  TEST_AGENT_ID,
  TEST_OTLP_KEY,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from './helpers';
import { encrypt, getEncryptionSecret } from '../src/common/utils/crypto.util';
import { RoutingCacheService } from '../src/routing/routing-core/routing-cache.service';

const MODEL = 'gpt-4o-mini';
const LEGACY_BILLING_ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_legacy',
  STRIPE_WEBHOOK_SECRET: 'whsec_legacy',
  STRIPE_PRO_PRICE_ID: 'price_legacy',
  PLAN_LIMIT_FREE_REQUESTS: '0',
};

let app: INestApplication;
let ds: DataSource;
let originalFetch: typeof global.fetch;
const previousEnv: Record<string, string | undefined> = {};
const providerCalls: string[] = [];
let providerStatus = 200;

function completion(): Record<string, unknown> {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 0,
    model: MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  };
}

beforeAll(async () => {
  for (const [key, value] of Object.entries(LEGACY_BILLING_ENV)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }

  app = await createTestApp();
  ds = app.get(DataSource);

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  await ds.query(
    `INSERT INTO tenant_providers
       (id, tenant_id, created_by_user_id, agent_id, provider, auth_type, api_key_encrypted,
        is_active, connected_at, updated_at, key_prefix, cached_models)
     VALUES ($1,$2,$3,$4,'openai','api_key',$5,true,$6,$6,'sk-test',$7)`,
    [
      'no-gate-openai',
      TEST_TENANT_ID,
      TEST_USER_ID,
      TEST_AGENT_ID,
      encrypt('sk-test-fake-key', getEncryptionSecret()),
      now,
      JSON.stringify([
        {
          id: MODEL,
          displayName: MODEL,
          provider: 'openai',
          authType: 'api_key',
          contextWindow: 128000,
          inputPricePerToken: 0.00000015,
          outputPricePerToken: 0.0000006,
          qualityScore: 3,
        },
      ]),
    ],
  );
  await ds.query(
    `INSERT INTO agent_enabled_providers (agent_id, tenant_provider_id) VALUES ($1, $2)`,
    [TEST_AGENT_ID, 'no-gate-openai'],
  );
  await ds.query(
    `INSERT INTO tier_assignments (id, agent_id, tier, override_route, updated_at)
     VALUES ($1, $2, 'default', $3::jsonb, $4)
     ON CONFLICT (agent_id, tier) DO UPDATE SET override_route = EXCLUDED.override_route`,
    [
      'no-gate-default',
      TEST_AGENT_ID,
      JSON.stringify({ provider: 'openai', authType: 'api_key', model: MODEL }),
      now,
    ],
  );
  await ds.query(`UPDATE agents SET complexity_routing_enabled = false WHERE id = $1`, [
    TEST_AGENT_ID,
  ]);

  originalFetch = global.fetch;
  global.fetch = (async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      // Non-absolute URL: fall through to the real fetch.
    }
    if (hostname === 'api.openai.com') {
      providerCalls.push(url);
      const body =
        providerStatus === 200
          ? completion()
          : { error: { message: 'insufficient credit', type: 'insufficient_quota' } };
      return new Response(JSON.stringify(body), {
        status: providerStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}, 60_000);

afterAll(async () => {
  if (originalFetch) global.fetch = originalFetch;
  if (app) await app.close();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  providerStatus = 200;
  providerCalls.length = 0;
  await ds.query(`DELETE FROM agent_messages WHERE agent_id = $1`, [TEST_AGENT_ID]);
  app.get(RoutingCacheService).invalidateAgent(TEST_AGENT_ID);
});

async function waitForAttempts(min: number): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 10_000;
  let rows: Array<Record<string, unknown>> = [];
  do {
    rows = await ds.query(
      `SELECT status, error_http_status, routing_reason, error_class, error_code
         FROM agent_messages
        WHERE agent_id = $1 AND status <> 'pending'`,
      [TEST_AGENT_ID],
    );
    if (rows.length >= min) return rows;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return rows;
}

describe('Proxy without a plan paywall (e2e)', () => {
  it('routes every request to the provider despite the legacy billing variables', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${TEST_OTLP_KEY}`)
        .send({ messages: [{ role: 'user', content: `hello ${i}` }] })
        .expect(200);

      expect(res.body.choices[0].message.content).toBe('pong');
      expect(res.headers['x-manifest-model']).toBe(MODEL);
    }

    expect(providerCalls).toHaveLength(3);
    const rows = await waitForAttempts(3);
    expect(rows.filter((row) => row.status === 'success')).toHaveLength(3);
    for (const row of rows) {
      expect(row.routing_reason).not.toBe('plan_request_limit_exceeded');
      expect(row.error_code).toBeNull();
    }
  });

  it('forwards a provider 402 as a provider error, not as a plan block', async () => {
    providerStatus = 402;

    const res = await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_OTLP_KEY}`)
      .send({ messages: [{ role: 'user', content: 'hello' }] })
      .expect(402);

    expect(providerCalls).toHaveLength(1);
    expect(res.body.error.source).toBe('provider');
    expect(res.body.error.code).not.toBe('PLAN_LIMIT_REQUESTS');
    expect(JSON.stringify(res.body)).not.toMatch(/upgrade|M204/i);

    const rows = await waitForAttempts(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ error_http_status: 402 });
    expect(rows[0]!.routing_reason).not.toBe('plan_request_limit_exceeded');
    expect(rows[0]!.error_code).not.toBe('M204');
  });
});
