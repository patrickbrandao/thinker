import { INestApplication } from '@nestjs/common';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  createTestApp,
  TEST_OTLP_KEY,
  TEST_API_KEY,
  TEST_AGENT_ID,
  TEST_TENANT_ID,
} from './helpers';
import { PricingSyncService } from '../src/database/pricing-sync.service';
import { ModelPricingCacheService } from '../src/model-prices/model-pricing-cache.service';
import { RoutingCacheService } from '../src/routing/routing-core/routing-cache.service';
import { ModelDiscoveryService } from '../src/model-discovery/model-discovery.service';
import { closeServer, redirectFetchToLoopback, serveOnLoopback } from './loopback';

let app: INestApplication;
let ds: DataSource;

/**
 * Stand-in for api.openai.com on 127.0.0.1 (issue #114): the suite must never
 * reach the internet, so the built-in `openai` provider's requests are routed
 * here. It answers a normal chat completion, or the provider's 401 when the
 * prompt asks for it, and records what the proxy forwarded.
 */
const FORCE_PROVIDER_401 = 'force-provider-401';
interface UpstreamCall {
  method: string;
  path: string;
  authorization?: string;
  body: Record<string, unknown> | null;
}
let upstream: Server;
let upstreamCalls: UpstreamCall[] = [];
let restoreFetch: () => void;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleOpenAi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  upstreamCalls.push({
    method: req.method ?? '',
    path: req.url ?? '',
    authorization: req.headers.authorization,
    body,
  });
  if (req.method === 'GET' && req.url === '/v1/models') {
    return json(res, 200, { object: 'list', data: [] });
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    return json(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } });
  }
  const messages = (body?.messages ?? []) as Array<{ content?: unknown }>;
  if (messages.some((m) => m.content === FORCE_PROVIDER_401)) {
    return json(res, 401, {
      error: {
        message: 'Incorrect API key provided: sk-fake-***-key.',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
  }
  return json(res, 200, {
    id: 'chatcmpl-loopback',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello from the loopback mock.' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
  });
}

beforeAll(async () => {
  upstream = await serveOnLoopback((req, res) => {
    handleOpenAi(req, res).catch((err: unknown) => json(res, 500, { error: String(err) }));
  });
  restoreFetch = redirectFetchToLoopback('https://api.openai.com', upstream);

  app = await createTestApp();

  ds = app.get(DataSource);

  // Populate PricingSyncService cache with gpt-4o-mini pricing (use prefixed key
  // so ModelPricingCacheService.inferProvider() resolves the correct provider name)
  const pricingSync = app.get(PricingSyncService);
  (
    pricingSync.getAll() as Map<string, { input: number; output: number; contextWindow?: number }>
  ).set('openai/gpt-4o-mini', {
    input: 0.00000015,
    output: 0.0000006,
    contextWindow: 128000,
  });

  // Reload pricing cache from OpenRouter cache + manual pricing
  const cache = app.get(ModelPricingCacheService);
  await cache.reload();

  // Connect OpenAI provider with a fake API key via API
  await request(app.getHttpServer())
    .post('/api/v1/routing/test-agent/providers')
    .set('x-api-key', TEST_API_KEY)
    .send({ provider: 'openai', apiKey: 'sk-fake-test-key' })
    .expect(201);

  // Seed discovered models on the provider record so tier auto-assign can pick them
  const models = JSON.stringify([
    {
      id: 'gpt-4o-mini',
      displayName: 'gpt-4o-mini',
      provider: 'openai',
      contextWindow: 128000,
      inputPricePerToken: 0.00000015,
      outputPricePerToken: 0.0000006,
      capabilityReasoning: false,
      capabilityCode: true,
      qualityScore: 2,
    },
  ]);
  await ds.query(
    `UPDATE tenant_providers SET cached_models = $1 WHERE tenant_id = $2 AND provider = $3`,
    [models, TEST_TENANT_ID, 'openai'],
  );

  // Model routing is user-controlled now (auto-assign was removed). Drop the
  // discovery cache so the just-seeded cached_models is visible, then pin
  // gpt-4o-mini on every scoring tier so the proxy always has a route, and
  // finally flush the routing caches.
  app.get(ModelDiscoveryService).invalidate(TEST_AGENT_ID);
  for (const tier of ['simple', 'standard', 'complex', 'reasoning', 'default']) {
    await ds.query(
      `INSERT INTO tier_assignments (id, agent_id, tier, override_route, updated_at)
       VALUES ($1,$2,$3,$4::jsonb, now())
       ON CONFLICT (agent_id, tier) DO UPDATE SET override_route = EXCLUDED.override_route`,
      [
        `tier-${tier}-proxy`,
        TEST_AGENT_ID,
        tier,
        JSON.stringify({ provider: 'openai', authType: 'api_key', model: 'gpt-4o-mini' }),
      ],
    );
  }
  const routingCache = app.get(RoutingCacheService);
  routingCache.invalidateAgent(TEST_AGENT_ID);
  routingCache.invalidateTenant(TEST_TENANT_ID);
}, 30000);

afterAll(async () => {
  await app?.close();
  restoreFetch?.();
  if (upstream) await closeServer(upstream);
});

beforeEach(() => {
  upstreamCalls = [];
});

const api = () => request(app.getHttpServer());
const bearer = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_OTLP_KEY}`);

describe('Proxy E2E — /v1/models', () => {
  it('rejects unauthenticated requests with HTTP 401', async () => {
    const res = await api().get('/v1/models').expect(401);

    expect(res.body.error.type).toBe('auth_error');
    expect(res.body.error.message).toContain('Missing the Authorization header');
  });

  it('lists the authenticated agent models using the OpenAI-compatible shape', async () => {
    const res = await bearer(api().get('/v1/models')).expect(200);

    expect(res.body).toEqual({
      object: 'list',
      data: [
        // `auto` routes only to gpt-4o-mini here, so it publishes that
        // model's window (ADR 0004, section 7). Real models carry none.
        {
          id: 'auto',
          object: 'model',
          created: 0,
          owned_by: 'thinker',
          context_length: 128000,
        },
        { id: 'openai/gpt-4o-mini', object: 'model', created: 0, owned_by: 'openai' },
      ],
    });
  });
});

describe('Proxy E2E — /v1/chat/completions', () => {
  // Supertest doesn't set Accept by default, and these requests omit
  // `stream: true`, so the exception filter classifies them as non-chat
  // clients (curl/CI/monitor) and returns real HTTP statuses with a
  // structured error envelope.

  it('rejects unauthenticated requests with HTTP 401', async () => {
    const res = await api()
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'hello' }] })
      .expect(401);

    expect(res.body.error.type).toBe('auth_error');
    expect(res.body.error.message).toContain('Missing the Authorization header');
  });

  it('rejects unauthenticated Responses API requests with HTTP 401', async () => {
    const res = await api().post('/v1/responses').send({ input: 'hello' }).expect(401);

    expect(res.body.error.type).toBe('auth_error');
    expect(res.body.error.message).toContain('Missing the Authorization header');
  });

  it('returns the friendly envelope when the caller opts into SSE chat semantics', async () => {
    const res = await api()
      .post('/v1/chat/completions')
      .set('Accept', 'text/event-stream')
      .send({ messages: [{ role: 'user', content: 'hello' }] })
      .expect(200);

    expect(res.body.choices[0].message.content).toContain('Missing the Authorization header');
  });

  it('returns HTTP 400 when messages are missing', async () => {
    const res = await bearer(api().post('/v1/chat/completions')).send({}).expect(400);

    expect(res.body.error.type).toBe('invalid_request_error');
    expect(res.body.error.message).toContain('messages');
  });

  it('returns HTTP 400 when Responses API input is missing', async () => {
    const res = await bearer(api().post('/v1/responses')).send({}).expect(400);

    expect(res.body.error.type).toBe('invalid_request_error');
    expect(res.body.error.message).toContain('messages');
  });

  it('#2494 returns M101 when an auto route points at a disconnected provider', async () => {
    const staleRoute = JSON.stringify({
      provider: 'opencode-go',
      authType: 'api_key',
      model: 'glm-5.2',
    });
    const restoredRoute = JSON.stringify({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-4o-mini',
    });
    const routingCache = app.get(RoutingCacheService);

    await ds.query(`UPDATE agents SET complexity_routing_enabled = false WHERE id = $1`, [
      TEST_AGENT_ID,
    ]);
    await ds.query(
      `UPDATE tier_assignments
       SET override_route = NULL, auto_assigned_route = $1::jsonb, fallback_routes = NULL
       WHERE agent_id = $2 AND tier = 'default'`,
      [staleRoute, TEST_AGENT_ID],
    );
    routingCache.invalidateAgent(TEST_AGENT_ID);
    routingCache.invalidateTenant(TEST_TENANT_ID);

    try {
      const res = await bearer(api().post('/v1/responses'))
        .send({ model: 'auto', input: 'Hello', store: false })
        .expect(200);
      const body = JSON.stringify(res.body);

      expect(body).toContain('M101');
      expect(body).not.toContain('M100');
      expect(body).not.toContain('opencode-go');
    } finally {
      await ds.query(`UPDATE agents SET complexity_routing_enabled = true WHERE id = $1`, [
        TEST_AGENT_ID,
      ]);
      await ds.query(
        `UPDATE tier_assignments
         SET override_route = $1::jsonb, auto_assigned_route = NULL, fallback_routes = NULL
         WHERE agent_id = $2 AND tier = 'default'`,
        [restoredRoute, TEST_AGENT_ID],
      );
      routingCache.invalidateAgent(TEST_AGENT_ID);
      routingCache.invalidateTenant(TEST_TENANT_ID);
    }
  });

  it('returns HTTP 400 when messages array is empty', async () => {
    const res = await bearer(api().post('/v1/chat/completions')).send({ messages: [] }).expect(400);

    expect(res.body.error.message).toContain('messages');
  });

  it('returns the friendly envelope for missing messages when stream=true', async () => {
    const res = await bearer(api().post('/v1/chat/completions')).send({ stream: true }).expect(200);

    // SSE payload — assert via raw text since supertest stores it on `text`.
    expect(res.text).toContain('messages');
  });

  it('resolves and forwards to the provider', async () => {
    // The full proxy pipeline: auth -> resolve -> forward, against the
    // loopback stand-in for api.openai.com.
    const res = await bearer(api().post('/v1/chat/completions'))
      .send({
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      })
      .expect(200);

    expect(res.body.choices[0].message.content).toBe('Hello from the loopback mock.');
    expect(res.headers['x-thinker-tier']).toBeDefined();
    expect(res.headers['x-thinker-model']).toBe('gpt-4o-mini');
    expect(res.headers['x-thinker-provider']).toBe('openai');

    const forwarded = upstreamCalls.filter((c) => c.path === '/v1/chat/completions');
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].method).toBe('POST');
    expect(forwarded[0].authorization).toBe('Bearer sk-fake-test-key');
    expect(forwarded[0].body).toMatchObject({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('does not return guard 401 envelope when a valid agent key is supplied', async () => {
    // Regression guard: if the AgentKeyAuthGuard ever rejects TEST_OTLP_KEY,
    // every forwarding test above degrades into "always 401". Pin the
    // contract explicitly so that a broken seed/key setup fails here.
    const res = await bearer(api().post('/v1/chat/completions')).send({
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body?.error).toBeUndefined();
  });

  it('includes X-Thinker-* headers when forwarding', async () => {
    const res = await bearer(api().post('/v1/chat/completions'))
      .send({
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      })
      .expect(200);

    expect(res.headers['x-thinker-tier']).toBeDefined();
    expect(res.headers['x-thinker-model']).toBeDefined();
    expect(res.headers['x-thinker-provider']).toBeDefined();
    expect(res.headers['x-thinker-confidence']).toBeDefined();
  });

  it('accepts X-Session-Key header without error', async () => {
    const res = await bearer(api().post('/v1/chat/completions'))
      .set('X-Session-Key', 'test-session-123')
      .send({
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      });

    // X-Session-Key must not trip body validation (400) or auth: the request
    // is routed and forwarded like any other.
    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toBe('Hello from the loopback mock.');
    expect(upstreamCalls.filter((c) => c.path === '/v1/chat/completions')).toHaveLength(1);
  });

  it('passes a provider 401 through with the provider error envelope', async () => {
    // A provider rejection must be told apart from the AgentKeyAuthGuard's own
    // 401: it carries the routing headers and `source: 'provider'`.
    // Keep this test last: the 401 puts the key in the credential rejection
    // cooldown, so later requests in this file would no longer be forwarded.
    const res = await bearer(api().post('/v1/chat/completions'))
      .send({
        messages: [{ role: 'user', content: FORCE_PROVIDER_401 }],
        stream: false,
      })
      .expect(401);

    expect(res.headers['x-thinker-tier']).toBeDefined();
    expect(res.headers['x-thinker-model']).toBe('gpt-4o-mini');
    expect(res.headers['x-thinker-provider']).toBe('openai');
    expect(res.body?.error?.status).toBe(401);
    expect(res.body?.error?.source).toBe('provider');
    expect(res.body?.error?.type).not.toBe('auth_error');
    expect(res.body?.error?.code).not.toBe('thinker_auth');
  });
});
