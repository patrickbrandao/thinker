/**
 * End-to-end cover for the client-visible Thinker identifiers (#21).
 *
 * Drives real `/v1/*` requests through the whole stack, with only the provider
 * transport stubbed, and asserts:
 *
 *   - agent keys carry the `thk_` prefix, and a key with the upstream
 *     project's prefix is refused as malformed (M003): there are no aliases;
 *   - routed responses carry `x-thinker-*` headers and none of the upstream
 *     project's headers;
 *   - `/v1/models` reports the synthetic `auto` route as owned by `thinker`;
 *   - a `thk_` key echoed back in a provider error body is stored redacted.
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
import { ModelPricingCacheService } from '../src/model-prices/model-pricing-cache.service';
import { PricingSyncService } from '../src/database/pricing-sync.service';
import { RoutingCacheService } from '../src/routing/routing-core/routing-cache.service';
import { API_KEY_PREFIX } from '../src/common/constants/api-key.constants';

let app: INestApplication;
let ds: DataSource;
let originalFetch: typeof global.fetch;

const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_HOST = 'api.openai.com';
const OPENAI_PROVIDER_KEY = 'sk-fake-openai-provider-key-thk';
/** A `thk_` token a provider echoes back in its 401 body. */
const ECHOED_SECRET = 'thk_echoed-by-the-provider-0123456789';

/** What the stubbed provider answers next. */
let upstreamMode: 'ok' | 'unauthorized' = 'ok';

const api = () => request(app.getHttpServer());

function openAiCompletion(): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-thk',
      object: 'chat.completion',
      created: 1,
      model: OPENAI_MODEL,
      choices: [
        { index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function openAiUnauthorized(): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: `Incorrect API key provided: ${ECHOED_SECRET}.`,
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_api_key',
      },
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);

  const prices = app.get(PricingSyncService).getAll() as Map<
    string,
    { input: number; output: number; contextWindow?: number }
  >;
  prices.set(`openai/${OPENAI_MODEL}`, {
    input: 0.00000015,
    output: 0.0000006,
    contextWindow: 128000,
  });
  await app.get(ModelPricingCacheService).reload();

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  await ds.query(
    `INSERT INTO tenant_providers
       (id, tenant_id, created_by_user_id, agent_id, provider, auth_type, api_key_encrypted, is_active, connected_at, updated_at, key_prefix, cached_models)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$8,$9,$10)`,
    [
      'up-openai-thk',
      TEST_TENANT_ID,
      TEST_USER_ID,
      TEST_AGENT_ID,
      'openai',
      'api_key',
      encrypt(OPENAI_PROVIDER_KEY, getEncryptionSecret()),
      now,
      'sk-fak',
      JSON.stringify([
        {
          id: OPENAI_MODEL,
          displayName: OPENAI_MODEL,
          provider: 'openai',
          authType: 'api_key',
          contextWindow: 128000,
          inputPricePerToken: 0.000001,
          outputPricePerToken: 0.000005,
          qualityScore: 5,
        },
      ]),
    ],
  );
  await ds.query(
    `INSERT INTO agent_enabled_providers (agent_id, tenant_provider_id) VALUES ($1,$2)`,
    [TEST_AGENT_ID, 'up-openai-thk'],
  );
  await ds.query(`UPDATE agents SET complexity_routing_enabled = false WHERE id = $1`, [
    TEST_AGENT_ID,
  ]);
  await ds.query(
    `INSERT INTO tier_assignments
       (id, agent_id, tier, override_route, auto_assigned_route, fallback_routes, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,NULL,$5::jsonb,$6)
     ON CONFLICT (agent_id, tier) DO UPDATE SET
       override_route = EXCLUDED.override_route,
       auto_assigned_route = NULL,
       fallback_routes = EXCLUDED.fallback_routes`,
    [
      'tier-default-thk',
      TEST_AGENT_ID,
      'default',
      JSON.stringify({ provider: 'openai', authType: 'api_key', model: OPENAI_MODEL }),
      JSON.stringify([]),
      now,
    ],
  );
  const routingCache = app.get(RoutingCacheService);
  routingCache.invalidateAgent(TEST_AGENT_ID);
  routingCache.invalidateTenant(TEST_TENANT_ID);

  originalFetch = global.fetch;
  global.fetch = (async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      // Non-absolute URL falls through to the real fetch.
    }
    if (hostname === OPENAI_HOST) {
      return upstreamMode === 'ok' ? openAiCompletion() : openAiUnauthorized();
    }
    return originalFetch!(input, init);
  }) as typeof fetch;
}, 60000);

afterAll(async () => {
  if (originalFetch) global.fetch = originalFetch;
  if (app) await app.close();
});

beforeEach(() => {
  upstreamMode = 'ok';
});

describe('Thinker identifiers on the gateway (e2e)', () => {
  it('uses the thk_ agent key prefix', () => {
    expect(API_KEY_PREFIX).toBe('thk_');
    expect(TEST_OTLP_KEY.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it('refuses a key with the upstream project prefix as malformed (M003)', async () => {
    const legacy = ['mnfst', 'legacy-agent-key-0001'].join('_');
    const res = await api()
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${legacy}`)
      .send({ model: OPENAI_MODEL, messages: [{ role: 'user', content: 'ping' }] })
      .expect(401);

    expect(res.body.error.type).toBe('auth_error');
    expect(res.body.error.message).toMatch(/\bM003\b/);
    expect(res.body.error.message).toContain('"thk_"');
  });

  it('sends x-thinker-* response headers and no legacy upstream header', async () => {
    const res = await api()
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_OTLP_KEY}`)
      .send({ model: OPENAI_MODEL, messages: [{ role: 'user', content: 'ping' }] })
      .expect(200);

    expect(res.headers['x-thinker-tier']).toBeDefined();
    expect(res.headers['x-thinker-model']).toBe(OPENAI_MODEL);
    expect(res.headers['x-thinker-provider']).toBe('openai');
    expect(res.headers['x-thinker-confidence']).toBeDefined();
    expect(res.headers['x-thinker-reason']).toBeDefined();
    const legacyPrefix = ['x', 'manifest', ''].join('-');
    expect(Object.keys(res.headers).filter((h) => h.startsWith(legacyPrefix))).toEqual([]);
  });

  it('reports the auto route as owned by thinker on /v1/models', async () => {
    const res = await api()
      .get('/v1/models')
      .set('Authorization', `Bearer ${TEST_OTLP_KEY}`)
      .expect(200);

    const auto = (res.body.data as Array<{ id: string; owned_by: string }>).find(
      (m) => m.id === 'auto',
    );
    expect(auto?.owned_by).toBe('thinker');
  });

  it('stores a thk_ key echoed in a provider error as [REDACTED]', async () => {
    await ds.query(`DELETE FROM agent_messages WHERE agent_id = $1`, [TEST_AGENT_ID]);
    upstreamMode = 'unauthorized';

    const res = await api()
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_OTLP_KEY}`)
      .send({ model: OPENAI_MODEL, messages: [{ role: 'user', content: 'ping' }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toContain(ECHOED_SECRET);

    // The failure row is written off the response path; poll until it lands.
    type Row = { status: string; error_message: string | null };
    const deadline = Date.now() + 10000;
    let failed: Row | undefined;
    do {
      const rows: Row[] = await ds.query(
        `SELECT status, error_message FROM agent_messages WHERE agent_id = $1`,
        [TEST_AGENT_ID],
      );
      failed = rows.find((r) => r.status !== 'success' && r.error_message);
      if (!failed) await new Promise((r) => setTimeout(r, 100));
    } while (!failed && Date.now() < deadline);

    expect(failed).toBeDefined();
    expect(failed!.error_message).not.toContain(ECHOED_SECRET);
    expect(failed!.error_message).toContain('[REDACTED]');
  });
});
