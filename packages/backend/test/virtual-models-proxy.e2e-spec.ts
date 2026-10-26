/**
 * Virtual models in the proxy (ADR 0004, PR 2): precedence over header tiers,
 * chain resolution with "continue on Default", M301, observability headers,
 * `agent_messages.virtual_model_*`, per-route params scopes, and the
 * unchanged behavior of `auto`, header tiers, heartbeats and the resolve
 * endpoint.
 *
 * Drives real requests through the whole proxy stack. The upstream providers
 * are built-in OpenAI and Anthropic connections whose hosts are answered by a
 * `global.fetch` stub, so every body Thinker sends upstream is inspected.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { ModelRoute } from 'thinker-shared';
import {
  createTestApp,
  TEST_AGENT_ID,
  TEST_OTLP_KEY,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from './helpers';
import { encrypt, getEncryptionSecret } from '../src/common/utils/crypto.util';
import { RoutingCacheService } from '../src/routing/routing-core/routing-cache.service';

let app: INestApplication;
let ds: DataSource;
let originalFetch: typeof global.fetch;

interface UpstreamCall {
  host: string;
  path: string;
  body: Record<string, unknown>;
}
const upstream: UpstreamCall[] = [];
/** Status each upstream model answers with; 200 when absent. */
const failing = new Map<string, number>();

const openai = (model: string, keyLabel?: string): ModelRoute =>
  keyLabel
    ? { provider: 'openai', authType: 'api_key', model, keyLabel }
    : { provider: 'openai', authType: 'api_key', model };
const anthropic = (model: string): ModelRoute => ({
  provider: 'anthropic',
  authType: 'api_key',
  model,
});

const PRIMARY = openai('gpt-4o');
const FALLBACK = openai('gpt-4o-mini');
const DEFAULT_ROUTE = openai('gpt-4.1');

const api = () => request(app.getHttpServer());
const asHarness = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_OTLP_KEY}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Endpoint = '/v1/chat/completions' | '/v1/responses' | '/v1/messages';
const ENDPOINTS: Endpoint[] = ['/v1/chat/completions', '/v1/responses', '/v1/messages'];

function bodyFor(endpoint: Endpoint, model: string, extra: Record<string, unknown> = {}) {
  if (endpoint === '/v1/responses') return { model, input: 'hello', ...extra };
  if (endpoint === '/v1/messages') {
    return { model, max_tokens: 64, messages: [{ role: 'user', content: 'hello' }], ...extra };
  }
  return { model, messages: [{ role: 'user', content: 'hello' }], ...extra };
}

function send(
  endpoint: Endpoint,
  model: string,
  opts: { headers?: Record<string, string>; extra?: Record<string, unknown> } = {},
) {
  let r = asHarness(api().post(endpoint));
  for (const [k, v] of Object.entries(opts.headers ?? {})) r = r.set(k, v);
  return r.send(bodyFor(endpoint, model, opts.extra));
}

function connection(
  id: string,
  provider: string,
  label: string,
  priority: number,
  models: string[],
) {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  return ds.query(
    `INSERT INTO tenant_providers
       (id, tenant_id, created_by_user_id, agent_id, provider, auth_type, api_key_encrypted,
        is_active, connected_at, updated_at, key_prefix, label, priority, cached_models)
     VALUES ($1,$2,$3,$4,$5,'api_key',$6,true,$7,$7,'sk-test',$8,$9,$10)`,
    [
      id,
      TEST_TENANT_ID,
      TEST_USER_ID,
      TEST_AGENT_ID,
      provider,
      encrypt(`fake-${id}`, getEncryptionSecret()),
      now,
      label,
      priority,
      JSON.stringify(
        models.map((m) => ({
          id: m,
          displayName: m,
          provider,
          authType: 'api_key',
          contextWindow: 128000,
          inputPricePerToken: 0.000001,
          outputPricePerToken: 0.000002,
          qualityScore: 3,
        })),
      ),
    ],
  );
}

async function setTier(
  tier: string,
  override: ModelRoute | null,
  fallbacks: ModelRoute[] | null = null,
  autoAssigned: ModelRoute | null = null,
) {
  await ds.query(
    `INSERT INTO tier_assignments (id, agent_id, tier, override_route, auto_assigned_route, fallback_routes, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, now())
     ON CONFLICT (agent_id, tier) DO UPDATE SET
       override_route = EXCLUDED.override_route,
       auto_assigned_route = EXCLUDED.auto_assigned_route,
       fallback_routes = EXCLUDED.fallback_routes`,
    [
      `vmp-tier-${tier}`,
      TEST_AGENT_ID,
      tier,
      override ? JSON.stringify(override) : null,
      autoAssigned ? JSON.stringify(autoAssigned) : null,
      fallbacks ? JSON.stringify(fallbacks) : null,
    ],
  );
  flush();
}

let vmCounter = 0;
async function createVirtual(
  name: string,
  opts: {
    primary?: ModelRoute | null;
    fallbacks?: ModelRoute[] | null;
    continueOnDefault?: boolean;
    enabled?: boolean;
    responseMode?: 'buffered' | 'stream';
  } = {},
): Promise<string> {
  const id = `vmp-${++vmCounter}`;
  await ds.query(
    `INSERT INTO virtual_models
       (id, tenant_id, agent_id, name, sort_order, enabled, override_route, fallback_routes,
        continue_on_default, response_mode, output_modality)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, 'text')`,
    [
      id,
      TEST_TENANT_ID,
      TEST_AGENT_ID,
      name,
      vmCounter,
      opts.enabled ?? true,
      opts.primary === null ? null : JSON.stringify(opts.primary ?? PRIMARY),
      opts.fallbacks ? JSON.stringify(opts.fallbacks) : null,
      opts.continueOnDefault ?? false,
      opts.responseMode ?? 'buffered',
    ],
  );
  flush();
  return id;
}

function flush() {
  app.get(RoutingCacheService).invalidateAgent(TEST_AGENT_ID);
}

interface Row {
  model: string | null;
  status: string;
  superseded: boolean;
  routing_reason: string | null;
  routing_tier: string | null;
  error_code: string | null;
  fallback_index: number | null;
  virtual_model_id: string | null;
  virtual_model_name: string | null;
  header_tier_id: string | null;
  header_tier_name: string | null;
  request_params: Record<string, unknown> | null;
}

/** Waits until the request's rows are all terminal (the recorder writes after the response). */
async function rowsAfter(count: number): Promise<Row[]> {
  const deadline = Date.now() + 10000;
  let rows: Row[] = [];
  do {
    rows = await ds.query(
      `SELECT model, status, superseded, routing_reason, routing_tier, error_code, fallback_index,
              virtual_model_id, virtual_model_name, header_tier_id, header_tier_name, request_params
         FROM agent_messages WHERE agent_id = $1 ORDER BY attempt_number NULLS FIRST, timestamp`,
      [TEST_AGENT_ID],
    );
    if (rows.length >= count && rows.every((r) => r.status !== 'pending')) return rows;
    await sleep(100);
  } while (Date.now() < deadline);
  return rows;
}

function upstreamModels(): string[] {
  return upstream.map((c) => String(c.body.model));
}

function chatCompletion(model: string) {
  return {
    id: 'chatcmpl-up',
    object: 'chat.completion',
    created: 1,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  };
}

function chatStream(model: string): string {
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id: 'chatcmpl-up',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return (
    chunk({ role: 'assistant', content: 'po' }, null) +
    chunk({ content: 'ng' }, 'stop') +
    `data: ${JSON.stringify({
      id: 'chatcmpl-up',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    })}\n\n` +
    'data: [DONE]\n\n'
  );
}

function responsesObject(model: string) {
  return {
    id: 'resp-up',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model,
    output: [
      {
        type: 'message',
        id: 'msg-up',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'pong', annotations: [] }],
      },
    ],
    usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
  };
}

function anthropicMessage(model: string) {
  return {
    id: 'msg-up',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: 'pong' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 1 },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function readBody(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (input instanceof Request) return input.clone().text();
  if (init?.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
  return '';
}

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);

  await connection('vmp-openai', 'openai', 'Default', 0, ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1']);
  await connection('vmp-openai-work', 'openai', 'Work', 1, ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1']);
  await connection('vmp-anthropic', 'anthropic', 'Default', 0, ['claude-sonnet-4-5']);
  await ds.query(
    `INSERT INTO agent_enabled_providers (agent_id, tenant_provider_id) VALUES ($1,$2),($1,$3),($1,$4)`,
    [TEST_AGENT_ID, 'vmp-openai', 'vmp-openai-work', 'vmp-anthropic'],
  );
  await ds.query(`UPDATE agents SET complexity_routing_enabled = false WHERE id = $1`, [
    TEST_AGENT_ID,
  ]);
  await ds.query(
    `INSERT INTO header_tiers (id, tenant_id, agent_id, name, header_key, header_value, badge_color, override_route)
     VALUES ('vmp-ht-deep', $1, $2, 'Deep', 'x-thinker-tier', 'deep', 'indigo', $3::jsonb)`,
    [TEST_TENANT_ID, TEST_AGENT_ID, JSON.stringify(anthropic('claude-sonnet-4-5'))],
  );

  originalFetch = global.fetch;
  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || !['api.openai.com', 'api.anthropic.com'].includes(parsed.hostname)) {
      return originalFetch(input, init);
    }
    const raw = await readBody(input, init);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    upstream.push({ host: parsed.hostname, path: parsed.pathname, body });
    const model = String(body.model);
    const status = failing.get(model);
    if (status)
      return json({ error: { message: `upstream ${model} down`, type: 'server_error' } }, status);
    if (parsed.pathname.endsWith('/messages')) return json(anthropicMessage(model));
    if (parsed.pathname.endsWith('/responses')) return json(responsesObject(model));
    if (body.stream === true) {
      return new Response(chatStream(model), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return json(chatCompletion(model));
  }) as typeof fetch;
}, 60000);

afterAll(async () => {
  if (originalFetch) global.fetch = originalFetch;
  if (app) await app.close();
});

/**
 * The recorder writes after the response is sent, so the previous test's rows
 * can still be landing. Wait until the row count stops moving, then clear.
 */
async function settleMessageRows(): Promise<void> {
  const count = async () =>
    Number(
      (
        await ds.query(`SELECT COUNT(*)::int AS n FROM agent_messages WHERE agent_id = $1`, [
          TEST_AGENT_ID,
        ])
      )[0].n,
    );
  let previous = await count();
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const current = await count();
    if (current === previous) break;
    previous = current;
  }
  await ds.query(`DELETE FROM agent_messages WHERE agent_id = $1`, [TEST_AGENT_ID]);
}

beforeEach(async () => {
  upstream.length = 0;
  failing.clear();
  await settleMessageRows();
  await ds.query(`DELETE FROM virtual_models WHERE agent_id = $1`, [TEST_AGENT_ID]);
  await ds.query(`DELETE FROM agent_model_params WHERE agent_id = $1`, [TEST_AGENT_ID]);
  await setTier('default', DEFAULT_ROUTE);
  await setTier('simple', FALLBACK);
});

describe('a virtual model on the three proxy endpoints', () => {
  it.each(ENDPOINTS)(
    '%s routes the chain and never sends the virtual name upstream',
    async (endpoint) => {
      const id = await createVirtual('deepseek/flash', { fallbacks: [FALLBACK] });

      const res = await send(endpoint, 'DeepSeek/Flash').expect(200);

      expect(res.headers['x-thinker-reason']).toBe('virtual-model');
      expect(res.headers['x-thinker-virtual-model']).toBe('deepseek/flash');
      expect(res.headers['x-thinker-tier']).toBe('default');
      expect(res.headers['x-thinker-model']).toBe('gpt-4o');
      expect(upstreamModels()).toEqual(['gpt-4o']);
      for (const call of upstream) {
        expect(JSON.stringify(call.body).toLowerCase()).not.toContain('deepseek/flash');
      }

      const rows = await rowsAfter(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'success',
        model: 'gpt-4o',
        routing_reason: 'virtual-model',
        virtual_model_id: id,
        virtual_model_name: 'deepseek/flash',
        header_tier_id: null,
        header_tier_name: null,
      });
    },
  );
});

describe('precedence: virtual model > header tier > auto / explicit', () => {
  it('a virtual model wins over a matching header tier', async () => {
    await createVirtual('deepseek/flash');

    const res = await send('/v1/chat/completions', 'deepseek/flash', {
      headers: { 'x-thinker-tier': 'deep' },
    }).expect(200);

    expect(res.headers['x-thinker-reason']).toBe('virtual-model');
    expect(upstream.map((c) => c.host)).toEqual(['api.openai.com']);
    const rows = await rowsAfter(1);
    expect(rows[0]).toMatchObject({ header_tier_id: null, virtual_model_name: 'deepseek/flash' });
  });

  it.each(['auto', 'openai/gpt-4.1'])('a header tier still wins over model %s', async (model) => {
    await createVirtual('deepseek/flash');

    const res = await send('/v1/chat/completions', model, {
      headers: { 'x-thinker-tier': 'deep' },
    }).expect(200);

    expect(res.headers['x-thinker-reason']).toBe('header-match');
    expect(res.headers['x-thinker-virtual-model']).toBeUndefined();
    expect(upstreamModels()).toEqual(['claude-sonnet-4-5']);
    const rows = await rowsAfter(1);
    expect(rows[0]).toMatchObject({ header_tier_id: 'vmp-ht-deep', virtual_model_id: null });
  });

  it('auto without headers keeps routing to the Default tier', async () => {
    await createVirtual('deepseek/flash');

    const res = await send('/v1/chat/completions', 'auto').expect(200);

    expect(res.headers['x-thinker-reason']).toBe('default');
    expect(upstreamModels()).toEqual(['gpt-4.1']);
  });
});

describe('shadowing a native model id', () => {
  it('captures a bare native id on /v1/messages while enabled, and releases it when disabled', async () => {
    const id = await createVirtual('claude-sonnet-4-5', { primary: PRIMARY });

    const shadowed = await send('/v1/messages', 'claude-sonnet-4-5').expect(200);
    expect(shadowed.headers['x-thinker-virtual-model']).toBe('claude-sonnet-4-5');
    expect(upstream.map((c) => [c.host, c.body.model])).toEqual([['api.openai.com', 'gpt-4o']]);

    await ds.query(`UPDATE virtual_models SET enabled = false WHERE id = $1`, [id]);
    flush();
    upstream.length = 0;

    const real = await send('/v1/messages', 'claude-sonnet-4-5').expect(200);
    expect(real.headers['x-thinker-virtual-model']).toBeUndefined();
    expect(real.headers['x-thinker-tier']).toBe('direct');
    expect(upstream.map((c) => [c.host, c.body.model])).toEqual([
      ['api.anthropic.com', 'claude-sonnet-4-5'],
    ]);
  });

  it('a disabled virtual with no real model behind it is M302', async () => {
    await createVirtual('ghost', { enabled: false });

    const res = await send('/v1/chat/completions', 'ghost').expect(200);

    expect(JSON.stringify(res.body)).toContain('M302');
    expect(upstream).toHaveLength(0);
  });
});

describe('M301 and continue_on_default', () => {
  it.each(ENDPOINTS)(
    '%s answers M301 when the chain has no route and the option is off',
    async (endpoint) => {
      const id = await createVirtual('broken', { primary: openai('gpt-gone') });

      const res = await send(endpoint, 'broken').expect(200);

      expect(JSON.stringify(res.body)).toContain('M301');
      expect(JSON.stringify(res.body)).toContain('broken');
      expect(JSON.stringify(res.body)).toContain('turn on \\"Continue on Default\\"');
      expect(res.headers['x-thinker-virtual-model']).toBe('broken');
      expect(upstream).toHaveLength(0);
      const rows = await rowsAfter(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'failed',
        error_code: 'M301',
        routing_reason: 'virtual_model_unavailable',
        virtual_model_id: id,
        virtual_model_name: 'broken',
        header_tier_id: null,
      });
    },
  );

  it('continues on the Default tier when the option is on', async () => {
    await createVirtual('broken', { primary: openai('gpt-gone'), continueOnDefault: true });

    const res = await send('/v1/chat/completions', 'broken').expect(200);

    expect(res.headers['x-thinker-reason']).toBe('virtual-model');
    expect(upstreamModels()).toEqual(['gpt-4.1']);
  });

  it('reaches a Default that only has the legacy auto-assigned route', async () => {
    await setTier('default', null, null, DEFAULT_ROUTE);
    await createVirtual('broken', { primary: openai('gpt-gone'), continueOnDefault: true });

    const res = await send('/v1/chat/completions', 'broken').expect(200);

    expect(JSON.stringify(res.body)).not.toContain('M301');
    expect(upstreamModels()).toEqual(['gpt-4.1']);
  });

  it('answers M301 when the option is on but the Default is empty', async () => {
    await setTier('default', null);
    await createVirtual('broken', { primary: openai('gpt-gone'), continueOnDefault: true });

    const res = await send('/v1/chat/completions', 'broken').expect(200);

    const text = JSON.stringify(res.body);
    expect(text).toContain('M301');
    expect(text).toContain('the Default tier it continues on has no available route either');
    expect(text).not.toContain('turn on');
    expect(upstream).toHaveLength(0);
  });
});

describe('runtime fallback inside the chain', () => {
  it('falls back within the virtual chain and records every row with the virtual', async () => {
    const id = await createVirtual('chain', { fallbacks: [FALLBACK] });
    failing.set('gpt-4o', 503);

    const res = await send('/v1/chat/completions', 'chain').expect(200);

    expect(res.headers['x-thinker-fallback-from']).toBe('gpt-4o');
    expect(res.headers['x-thinker-fallback-index']).toBe('0');
    expect(res.headers['x-thinker-virtual-model']).toBe('chain');
    expect(upstreamModels()).toEqual(['gpt-4o', 'gpt-4o-mini']);
    const rows = await rowsAfter(2);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ virtual_model_id: id, routing_reason: 'virtual-model' });
    }
    expect(rows.map((r) => [r.model, r.status])).toEqual([
      ['gpt-4o', 'failed'],
      ['gpt-4o-mini', 'success'],
    ]);
  });

  it('falls back on a stream into the part appended from the Default tier', async () => {
    await createVirtual('chain', { continueOnDefault: true });
    failing.set('gpt-4o', 503);

    const res = await send('/v1/chat/completions', 'chain', { extra: { stream: true } }).expect(
      200,
    );

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-thinker-fallback-from']).toBe('gpt-4o');
    expect(res.headers['x-thinker-virtual-model']).toBe('chain');
    expect(res.text).toContain('[DONE]');
    expect(upstreamModels()).toEqual(['gpt-4o', 'gpt-4.1']);
  });

  it('reports an exhausted chain with every row tied to the virtual', async () => {
    const id = await createVirtual('chain', { fallbacks: [FALLBACK] });
    failing.set('gpt-4o', 503);
    failing.set('gpt-4o-mini', 503);

    const res = await send('/v1/chat/completions', 'chain');

    expect(res.status).toBe(503);
    expect(res.headers['x-thinker-fallback-exhausted']).toBe('true');
    const rows = await rowsAfter(2);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.virtual_model_id === id)).toBe(true);
  });
});

describe('chain deduplication', () => {
  it('does not retry a Default route already in the virtual chain (label resolved per request)', async () => {
    // The virtual names gpt-4.1 with no key label; the Default pins the
    // "Default" key, which is the default connection: one route, one attempt.
    await setTier('default', openai('gpt-4.1', 'Default'));
    await createVirtual('dup', { primary: DEFAULT_ROUTE, continueOnDefault: true });
    failing.set('gpt-4.1', 503);

    const res = await send('/v1/chat/completions', 'dup');

    expect(res.status).toBe(503);
    expect(upstreamModels()).toEqual(['gpt-4.1']);
  });

  it('keeps the same model on another key as its own attempt', async () => {
    await setTier('default', openai('gpt-4.1', 'Work'));
    await createVirtual('dup', { primary: DEFAULT_ROUTE, continueOnDefault: true });
    failing.set('gpt-4.1', 503);

    await send('/v1/chat/completions', 'dup');

    expect(upstreamModels()).toEqual(['gpt-4.1', 'gpt-4.1']);
  });
});

describe('per-route params scope', () => {
  async function params(scope: string, model: string, temperature: number) {
    await ds.query(
      `INSERT INTO agent_model_params (id, agent_id, scope_key, provider, auth_type, model_name, params)
       VALUES ($1, $2, $3, 'openai', 'api_key', $4, $5::jsonb)`,
      [`vmp-p-${scope}-${model}`, TEST_AGENT_ID, scope, model, JSON.stringify({ temperature })],
    );
    flush();
  }

  it.each([false, true])(
    'records every row with the params of its own route (stream: %s)',
    async (stream) => {
      const id = await createVirtual('scoped', { fallbacks: [FALLBACK], continueOnDefault: true });
      await params(`virtual:${id}`, 'gpt-4o', 0.1);
      await params(`virtual:${id}`, 'gpt-4o-mini', 0.3);
      // A row under the virtual scope for the Default's model must not apply
      // to the route the chain borrowed from the Default.
      await params(`virtual:${id}`, 'gpt-4.1', 0.5);
      await params('tier:default', 'gpt-4.1', 0.9);
      failing.set('gpt-4o', 503);
      failing.set('gpt-4o-mini', 503);

      await send('/v1/chat/completions', 'scoped', { extra: { stream } }).expect(200);

      expect(upstream.map((c) => [c.body.model, c.body.temperature])).toEqual([
        ['gpt-4o', 0.1],
        ['gpt-4o-mini', 0.3],
        ['gpt-4.1', 0.9],
      ]);
      const rows = await rowsAfter(3);
      expect(rows.map((r) => [r.model, r.status, (r.request_params ?? {}).temperature])).toEqual([
        ['gpt-4o', 'failed', 0.1],
        ['gpt-4o-mini', 'failed', 0.3],
        ['gpt-4.1', 'success', 0.9],
      ]);
    },
  );

  it('records the exhausted chain rows with their own params', async () => {
    const id = await createVirtual('scoped', { continueOnDefault: true });
    await params(`virtual:${id}`, 'gpt-4o', 0.1);
    await params('tier:default', 'gpt-4.1', 0.9);
    failing.set('gpt-4o', 503);
    failing.set('gpt-4.1', 503);

    await send('/v1/chat/completions', 'scoped').expect(503);

    const rows = await rowsAfter(2);
    expect(rows.map((r) => [r.model, (r.request_params ?? {}).temperature])).toEqual([
      ['gpt-4o', 0.1],
      ['gpt-4.1', 0.9],
    ]);
  });

  it('uses tier:default for a primary that came from the Default tier', async () => {
    const id = await createVirtual('scoped', {
      primary: openai('gpt-gone'),
      continueOnDefault: true,
    });
    await params(`virtual:${id}`, 'gpt-4.1', 0.5);
    await params('tier:default', 'gpt-4.1', 0.9);

    await send('/v1/chat/completions', 'scoped').expect(200);

    expect(upstream.map((c) => [c.body.model, c.body.temperature])).toEqual([['gpt-4.1', 0.9]]);
    const rows = await rowsAfter(1);
    expect(rows[0].request_params).toMatchObject({ temperature: 0.9 });
  });
});

describe('unchanged behaviors', () => {
  it('a heartbeat with a header tier header still goes to the simple tier', async () => {
    const res = await send('/v1/chat/completions', 'auto', {
      headers: { 'x-thinker-tier': 'deep' },
      extra: { messages: [{ role: 'user', content: 'HEARTBEAT_OK' }] },
    }).expect(200);

    expect(res.headers['x-thinker-tier']).toBe('simple');
    expect(res.headers['x-thinker-reason']).toBe('heartbeat');
    expect(upstreamModels()).toEqual(['gpt-4o-mini']);
  });

  it('POST /api/v1/routing/resolve does not apply header tiers', async () => {
    const res = await asHarness(api().post('/api/v1/routing/resolve'))
      .set('x-thinker-tier', 'deep')
      .send({ messages: [{ role: 'user', content: 'hello' }] })
      .expect(200);

    expect(res.body.reason).not.toBe('header-match');
    expect(res.body.header_tier_id).toBeUndefined();
    expect(res.body.route).toMatchObject({ provider: 'openai', model: 'gpt-4.1' });
  });
});
