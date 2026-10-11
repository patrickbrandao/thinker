/**
 * End-to-end cover for `x-api-key` as an agent-key transport (#61).
 *
 * The Anthropic SDK (and Claude Code with ANTHROPIC_API_KEY) authenticates with
 * `x-api-key: <key>` instead of `Authorization: Bearer <key>`. These tests drive
 * real `/v1/*` requests through the whole stack — Express header handling,
 * AgentKeyAuthGuard, ProxyExceptionFilter, routing, credential resolution and
 * the provider client — with only the provider transport stubbed, and assert:
 *
 *   - every route behind AgentKeyAuthGuard accepts the key on `x-api-key`
 *     (`/v1/*`, `/api/v1/agent/*`, `/api/v1/routing/*`);
 *   - two different keys on one request are refused with M006;
 *   - the caller's key never crosses to the provider: the upstream request
 *     carries the provider's own credential and nothing else;
 *   - the key is not persisted in the recorded request headers.
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

interface UpstreamCall {
  host: string;
  headers: Record<string, string>;
  body: string;
}
/** Every request that reached a stubbed provider. */
const upstreamCalls: UpstreamCall[] = [];

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const OPENAI_MODEL = 'gpt-4o-mini';
const ANTHROPIC_HOST = 'api.anthropic.com';
const OPENAI_HOST = 'api.openai.com';
const ANTHROPIC_PROVIDER_KEY = 'fake-anthropic-provider-key';
const OPENAI_PROVIDER_KEY = 'sk-fake-openai-provider-key';
/** Well-formed, but belongs to no agent. */
const OTHER_AGENT_KEY = `${API_KEY_PREFIX}some-other-agent-key-0001`;

const api = () => request(app.getHttpServer());

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const raw = init?.headers;
  if (!raw) return {};
  if (raw instanceof Headers) return Object.fromEntries(raw.entries());
  if (Array.isArray(raw)) return Object.fromEntries(raw);
  return { ...(raw as Record<string, string>) };
}

function anthropicMessage(): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_xak',
      type: 'message',
      role: 'assistant',
      model: ANTHROPIC_MODEL,
      content: [{ type: 'text', text: 'pong' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function openAiCompletion(): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-xak',
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

async function insertProvider(
  id: string,
  provider: string,
  apiKey: string,
  keyPrefix: string,
  model: string,
): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  await ds.query(
    `INSERT INTO tenant_providers
       (id, tenant_id, created_by_user_id, agent_id, provider, auth_type, api_key_encrypted, is_active, connected_at, updated_at, key_prefix, cached_models)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$8,$9,$10)`,
    [
      id,
      TEST_TENANT_ID,
      TEST_USER_ID,
      TEST_AGENT_ID,
      provider,
      'api_key',
      encrypt(apiKey, getEncryptionSecret()),
      now,
      keyPrefix,
      JSON.stringify([
        {
          id: model,
          displayName: model,
          provider,
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
    [TEST_AGENT_ID, id],
  );
}

/** Point the agent's default tier at one provider/model and drop routing caches. */
async function routeDefaultTierTo(provider: string, model: string): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  await ds.query(
    `INSERT INTO tier_assignments
       (id, agent_id, tier, override_route, auto_assigned_route, fallback_routes, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,NULL,$5::jsonb,$6)
     ON CONFLICT (agent_id, tier) DO UPDATE SET
       override_route = EXCLUDED.override_route,
       auto_assigned_route = NULL,
       fallback_routes = EXCLUDED.fallback_routes`,
    [
      'tier-default-xak',
      TEST_AGENT_ID,
      'default',
      JSON.stringify({ provider, authType: 'api_key', model }),
      JSON.stringify([]),
      now,
    ],
  );
  const routingCache = app.get(RoutingCacheService);
  routingCache.invalidateAgent(TEST_AGENT_ID);
  routingCache.invalidateTenant(TEST_TENANT_ID);
}

/** The caller's agent key must not appear anywhere in what reached a provider. */
function expectNoAgentKeyUpstream(call: UpstreamCall): void {
  for (const [name, value] of Object.entries(call.headers)) {
    expect(`${name}: ${value}`).not.toContain(TEST_OTLP_KEY);
  }
  expect(call.body).not.toContain(TEST_OTLP_KEY);
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);

  const sync = app.get(PricingSyncService);
  const prices = sync.getAll() as Map<
    string,
    { input: number; output: number; contextWindow?: number }
  >;
  prices.set(`anthropic/${ANTHROPIC_MODEL}`, {
    input: 0.000001,
    output: 0.000005,
    contextWindow: 200000,
  });
  prices.set(`openai/${OPENAI_MODEL}`, {
    input: 0.00000015,
    output: 0.0000006,
    contextWindow: 128000,
  });
  await app.get(ModelPricingCacheService).reload();

  await insertProvider(
    'up-anthropic-xak',
    'anthropic',
    ANTHROPIC_PROVIDER_KEY,
    'fake-a',
    ANTHROPIC_MODEL,
  );
  await insertProvider('up-openai-xak', 'openai', OPENAI_PROVIDER_KEY, 'sk-fak', OPENAI_MODEL);

  await ds.query(`UPDATE agents SET complexity_routing_enabled = false WHERE id = $1`, [
    TEST_AGENT_ID,
  ]);
  await routeDefaultTierTo('anthropic', ANTHROPIC_MODEL);

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
    if (hostname === ANTHROPIC_HOST || hostname === OPENAI_HOST) {
      upstreamCalls.push({
        host: hostname,
        headers: headersOf(init),
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return hostname === ANTHROPIC_HOST ? anthropicMessage() : openAiCompletion();
    }
    return originalFetch!(input, init);
  }) as typeof fetch;
}, 60000);

afterAll(async () => {
  if (originalFetch) global.fetch = originalFetch;
  if (app) await app.close();
});

beforeEach(() => {
  upstreamCalls.length = 0;
});

describe('x-api-key on the gateway routes (e2e)', () => {
  describe('Anthropic upstream', () => {
    it('POST /v1/messages accepts x-api-key and sends the provider key upstream', async () => {
      const res = await api()
        .post('/v1/messages')
        .set('x-api-key', TEST_OTLP_KEY)
        .set('anthropic-version', '2023-06-01')
        .set('anthropic-beta', 'context-management-2025-06-27')
        .send({
          model: ANTHROPIC_MODEL,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'ping' }],
        })
        .expect(200);

      expect(res.body.type).toBe('message');
      expect(upstreamCalls).toHaveLength(1);
      const call = upstreamCalls[0]!;
      const headers = lowerKeys(call.headers);
      // Anthropic authenticates with x-api-key too: it must be the provider's
      // credential, never the caller's agent key.
      expect(headers['x-api-key']).toBe(ANTHROPIC_PROVIDER_KEY);
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect((headers['anthropic-beta'] ?? '').split(',')).toContain(
        'context-management-2025-06-27',
      );
      expectNoAgentKeyUpstream(call);
    });

    it('POST /v1/chat/completions accepts x-api-key', async () => {
      const res = await api()
        .post('/v1/chat/completions')
        .set('x-api-key', TEST_OTLP_KEY)
        .send({ model: ANTHROPIC_MODEL, messages: [{ role: 'user', content: 'ping' }] })
        .expect(200);

      expect(res.body.object).toBe('chat.completion');
      expect(upstreamCalls).toHaveLength(1);
      expect(lowerKeys(upstreamCalls[0]!.headers)['x-api-key']).toBe(ANTHROPIC_PROVIDER_KEY);
      expectNoAgentKeyUpstream(upstreamCalls[0]!);
    });

    it('POST /v1/responses accepts x-api-key', async () => {
      const res = await api()
        .post('/v1/responses')
        .set('x-api-key', TEST_OTLP_KEY)
        .send({ model: ANTHROPIC_MODEL, input: 'ping', store: false })
        .expect(200);

      expect(res.body.object).toBe('response');
      expect(upstreamCalls).toHaveLength(1);
      expect(lowerKeys(upstreamCalls[0]!.headers)['x-api-key']).toBe(ANTHROPIC_PROVIDER_KEY);
      expectNoAgentKeyUpstream(upstreamCalls[0]!);
    });

    it('GET /v1/models accepts x-api-key', async () => {
      const res = await api().get('/v1/models').set('x-api-key', TEST_OTLP_KEY).expect(200);

      expect(res.body.object).toBe('list');
      expect(res.body.data.map((m: { id: string }) => m.id)).toContain('auto');
    });

    it('accepts Bearer and x-api-key together when they carry the same key', async () => {
      await api()
        .post('/v1/messages')
        .set('Authorization', `Bearer ${TEST_OTLP_KEY}`)
        .set('x-api-key', TEST_OTLP_KEY)
        .set('anthropic-version', '2023-06-01')
        .send({
          model: ANTHROPIC_MODEL,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'ping' }],
        })
        .expect(200);

      expect(upstreamCalls).toHaveLength(1);
      expectNoAgentKeyUpstream(upstreamCalls[0]!);
    });
  });

  describe('OpenAI upstream', () => {
    beforeAll(async () => {
      await routeDefaultTierTo('openai', OPENAI_MODEL);
    });

    afterAll(async () => {
      await routeDefaultTierTo('anthropic', ANTHROPIC_MODEL);
    });

    it('does not forward the caller x-api-key to a Bearer-authenticated provider', async () => {
      await api()
        .post('/v1/chat/completions')
        .set('x-api-key', TEST_OTLP_KEY)
        .send({ model: OPENAI_MODEL, messages: [{ role: 'user', content: 'ping' }] })
        .expect(200);

      expect(upstreamCalls).toHaveLength(1);
      const headers = lowerKeys(upstreamCalls[0]!.headers);
      expect(upstreamCalls[0]!.host).toBe(OPENAI_HOST);
      expect(headers['authorization']).toBe(`Bearer ${OPENAI_PROVIDER_KEY}`);
      expect(headers).not.toHaveProperty('x-api-key');
      expectNoAgentKeyUpstream(upstreamCalls[0]!);
    });

    it('translates /v1/messages to the OpenAI provider without leaking the agent key', async () => {
      const res = await api()
        .post('/v1/messages')
        .set('x-api-key', TEST_OTLP_KEY)
        .set('anthropic-version', '2023-06-01')
        .send({
          model: OPENAI_MODEL,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'ping' }],
        })
        .expect(200);

      expect(res.body.type).toBe('message');
      expect(upstreamCalls).toHaveLength(1);
      const headers = lowerKeys(upstreamCalls[0]!.headers);
      expect(headers).not.toHaveProperty('x-api-key');
      expectNoAgentKeyUpstream(upstreamCalls[0]!);
    });
  });

  describe('rejections', () => {
    it.each(['/v1/messages', '/v1/chat/completions', '/v1/responses'])(
      'POST %s refuses two different keys with M006 and calls no provider',
      async (path) => {
        const res = await api()
          .post(path)
          .set('Authorization', `Bearer ${TEST_OTLP_KEY}`)
          .set('x-api-key', OTHER_AGENT_KEY)
          .send({ model: ANTHROPIC_MODEL, messages: [{ role: 'user', content: 'ping' }] })
          .expect(401);

        expect(res.body.error.type).toBe('auth_error');
        expect(res.body.error.message).toContain('M006');
        expect(JSON.stringify(res.body)).not.toContain(TEST_OTLP_KEY);
        expect(JSON.stringify(res.body)).not.toContain(OTHER_AGENT_KEY);
        expect(upstreamCalls).toHaveLength(0);
      },
    );

    it('refuses an unknown key on x-api-key with M005', async () => {
      const res = await api()
        .post('/v1/messages')
        .set('x-api-key', OTHER_AGENT_KEY)
        .send({ model: ANTHROPIC_MODEL, messages: [{ role: 'user', content: 'ping' }] })
        .expect(401);

      expect(res.body.error.message).toContain('M005');
      expect(upstreamCalls).toHaveLength(0);
    });

    it('refuses a request with no key with M001 that names both transports', async () => {
      const res = await api()
        .post('/v1/messages')
        .send({ model: ANTHROPIC_MODEL, messages: [{ role: 'user', content: 'ping' }] })
        .expect(401);

      expect(res.body.error.message).toContain('M001');
      expect(res.body.error.message).toContain('x-api-key');
      expect(upstreamCalls).toHaveLength(0);
    });
  });

  describe('agent API routes outside /v1', () => {
    it('GET /api/v1/agent/usage accepts x-api-key', async () => {
      const res = await api()
        .get('/api/v1/agent/usage')
        .set('x-api-key', TEST_OTLP_KEY)
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('POST /api/v1/routing/resolve accepts x-api-key', async () => {
      const res = await api()
        .post('/api/v1/routing/resolve')
        .set('x-api-key', TEST_OTLP_KEY)
        .send({ messages: [{ role: 'user', content: 'hello' }] })
        .expect(200);

      expect(res.body.tier).toBeDefined();
    });

    it('refuses conflicting keys there with a plain 401 (no gateway M006 envelope)', async () => {
      const res = await api()
        .get('/api/v1/agent/usage')
        .set('Authorization', `Bearer ${TEST_OTLP_KEY}`)
        .set('x-api-key', OTHER_AGENT_KEY)
        .expect(401);

      expect(res.body.message).toBe('Conflicting API key headers');
      expect(JSON.stringify(res.body)).not.toContain(TEST_OTLP_KEY);
      expect(JSON.stringify(res.body)).not.toContain(OTHER_AGENT_KEY);
    });

    it('refuses an unknown x-api-key there with a plain 401', async () => {
      const res = await api()
        .post('/api/v1/routing/resolve')
        .set('x-api-key', OTHER_AGENT_KEY)
        .send({ messages: [{ role: 'user', content: 'hello' }] })
        .expect(401);

      expect(res.body.message).toBe('Invalid API key');
    });
  });

  it('never persists the x-api-key header in recorded request headers', async () => {
    await api()
      .post('/v1/messages')
      .set('x-api-key', TEST_OTLP_KEY)
      .set('anthropic-version', '2023-06-01')
      .set('x-xak-marker', 'recorded')
      .send({
        model: ANTHROPIC_MODEL,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'ping' }],
      })
      .expect(200);

    // The recorder is fire-and-forget: wait until BOTH the Request row and its
    // provider-attempt row have landed, so neither table is skipped.
    const markedRows = async (table: 'requests' | 'agent_messages') =>
      (await ds.query(
        `SELECT request_headers::text AS headers FROM ${table}
          WHERE request_headers::text LIKE '%x-xak-marker%'`,
      )) as Array<{ headers: string }>;
    const deadline = Date.now() + 5000;
    let requestRows: Array<{ headers: string }> = [];
    let attemptRows: Array<{ headers: string }> = [];
    while (Date.now() < deadline) {
      requestRows = await markedRows('requests');
      attemptRows = await markedRows('agent_messages');
      if (requestRows.length > 0 && attemptRows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(requestRows.length).toBeGreaterThan(0);
    expect(attemptRows.length).toBeGreaterThan(0);
    for (const row of [...requestRows, ...attemptRows]) {
      expect(row.headers).toContain('anthropic-version');
      expect(row.headers.toLowerCase()).not.toContain('x-api-key');
      expect(row.headers).not.toContain(TEST_OTLP_KEY);
    }
  });
});
