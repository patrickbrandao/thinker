/**
 * `GET /v1/models` with virtual models and `context_length` (ADR 0004,
 * section 7, PR 3): order, hiding of shadowed real models, isolation between
 * agent keys of the same tenant and of different tenants, and the
 * `context_length` of `auto` and of each virtual model.
 *
 * Discovery is stubbed in the app (no provider APIs in e2e), so the agents'
 * catalog and provider keys come from spies on the real services.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { ModelRoute } from 'thinker-shared';
import { createTestApp, TEST_AGENT_ID, TEST_API_KEY, TEST_OTLP_KEY } from './helpers';
import { ModelDiscoveryService } from '../src/model-discovery/model-discovery.service';
import type { DiscoveredModel } from '../src/model-discovery/model-fetcher';
import { ProviderKeyService } from '../src/routing/routing-core/provider-key.service';
import { RoutingCacheService } from '../src/routing/routing-core/routing-cache.service';

let app: INestApplication;
let ds: DataSource;

const A_BASE = '/api/v1/routing/test-agent/virtual-models';
const SIBLING_NAME = 'vml-sibling';
const SIBLING_BASE = `/api/v1/routing/${SIBLING_NAME}/virtual-models`;
const USER_B = 'vml-user-b';
const B_AGENT_NAME = 'vml-b-agent';
const B_BASE = `/api/v1/routing/${B_AGENT_NAME}/virtual-models`;
const CUSTOM_ID = 'custom:0b5e1a52-9a0e-4c55-9d43-7d1f4a3f0c11';

let siblingKey: string;
let bKey: string;

const api = () => request(app.getHttpServer());
const asA = (r: request.Test) => r.set('x-api-key', TEST_API_KEY);
const asB = (r: request.Test) => r.set('x-api-key', TEST_API_KEY).set('x-test-user-id', USER_B);
const listAs = (key: string, query = '') =>
  api().get(`/v1/models${query}`).set('Authorization', `Bearer ${key}`).expect(200);

const model = (
  id: string,
  provider: string,
  contextWindow: number,
  extra: Partial<DiscoveredModel> = {},
): DiscoveredModel =>
  ({
    id,
    displayName: id,
    provider,
    contextWindow,
    inputPricePerToken: 0.000001,
    outputPricePerToken: 0.000002,
    capabilityReasoning: false,
    capabilityCode: false,
    qualityScore: 3,
    authType: 'api_key',
    ...extra,
  }) as DiscoveredModel;

const CATALOG: DiscoveredModel[] = [
  model('gpt-4o', 'openai', 128000),
  model('gpt-4o-mini', 'openai', 100000),
  model('claude-sonnet-4-5', 'anthropic', 200000),
  model('deepseek-chat', 'deepseek', 64000),
  model('mystery', 'mistral', 0),
  model(`${CUSTOM_ID}/model-a`, CUSTOM_ID, 32000, { providerName: 'My Gateway' }),
];

const route = (provider: string, m: string): ModelRoute => ({
  provider,
  authType: 'api_key',
  model: m,
});

interface ListedModel {
  id: string;
  context_length?: number;
  [key: string]: unknown;
}

const ids = (body: { data: ListedModel[] }) => body.data.map((m) => m.id);
const entry = (body: { data: ListedModel[] }, id: string) => body.data.find((m) => m.id === id);

async function setTier(
  agentId: string,
  tier: string,
  routes: {
    override?: ModelRoute | null;
    auto?: ModelRoute | null;
    fallbacks?: ModelRoute[] | null;
  },
): Promise<void> {
  await ds.query(
    `INSERT INTO tier_assignments
       (id, agent_id, tier, override_route, auto_assigned_route, fallback_routes,
        output_modality, response_mode, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, 'text', 'buffered', now())
     ON CONFLICT (agent_id, tier) DO UPDATE SET
       override_route = EXCLUDED.override_route,
       auto_assigned_route = EXCLUDED.auto_assigned_route,
       fallback_routes = EXCLUDED.fallback_routes`,
    [
      `vml-${agentId}-${tier}`,
      agentId,
      tier,
      routes.override ? JSON.stringify(routes.override) : null,
      routes.auto ? JSON.stringify(routes.auto) : null,
      routes.fallbacks ? JSON.stringify(routes.fallbacks) : null,
    ],
  );
  app.get(RoutingCacheService).invalidateAgent(agentId);
}

async function setComplexity(agentId: string, enabled: boolean): Promise<void> {
  await ds.query(`UPDATE agents SET complexity_routing_enabled = $2 WHERE id = $1`, [
    agentId,
    enabled,
  ]);
}

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);

  jest.spyOn(app.get(ModelDiscoveryService), 'getModelsForAgent').mockResolvedValue(CATALOG);
  jest
    .spyOn(app.get(ProviderKeyService), 'getProviderKeys')
    .mockResolvedValue([{ id: 'k1', label: 'Default', priority: 0, apiKey: 'sk-1', region: null }]);

  const sibling = await asA(api().post('/api/v1/agents')).send({ name: SIBLING_NAME }).expect(201);
  siblingKey = sibling.body.apiKey;
  const b = await asB(api().post('/api/v1/agents')).send({ name: B_AGENT_NAME }).expect(201);
  bKey = b.body.apiKey;
  expect(siblingKey).toMatch(/^thk_/);
  expect(bKey).toMatch(/^thk_/);
}, 60000);

afterAll(async () => {
  jest.restoreAllMocks();
  await app.close();
});

describe('auto context_length', () => {
  beforeAll(async () => {
    for (const slot of ['simple', 'standard', 'complex', 'reasoning', 'default']) {
      await setTier(TEST_AGENT_ID, slot, {});
    }
  });

  it('is omitted when no destination has a route', async () => {
    await setComplexity(TEST_AGENT_ID, true);
    const res = await listAs(TEST_OTLP_KEY);
    expect(res.body.data[0]).toEqual({
      id: 'auto',
      object: 'model',
      created: 0,
      owned_by: 'thinker',
    });
  });

  it('with complexity routing on, is the minimum across the slots and the default', async () => {
    await setTier(TEST_AGENT_ID, 'simple', { override: route('openai', 'gpt-4o-mini') });
    await setTier(TEST_AGENT_ID, 'default', { override: route('anthropic', 'claude-sonnet-4-5') });
    const res = await listAs(TEST_OTLP_KEY);
    expect(res.body.data[0]).toEqual({
      id: 'auto',
      object: 'model',
      created: 0,
      owned_by: 'thinker',
      context_length: 100000,
    });
  });

  it('with complexity routing on, includes active specificity assignments only', async () => {
    await ds.query(
      `INSERT INTO specificity_assignments
         (id, agent_id, category, is_active, override_route, auto_assigned_route, fallback_routes,
          output_modality, response_mode, updated_at)
       VALUES ('vml-spec', $1, 'coding', false, $2::jsonb, NULL, NULL, 'text', 'buffered', now())`,
      [TEST_AGENT_ID, JSON.stringify(route('deepseek', 'deepseek-chat'))],
    );
    app.get(RoutingCacheService).invalidateAgent(TEST_AGENT_ID);
    expect(entry((await listAs(TEST_OTLP_KEY)).body, 'auto')?.context_length).toBe(100000);

    await ds.query(`UPDATE specificity_assignments SET is_active = true WHERE id = 'vml-spec'`);
    app.get(RoutingCacheService).invalidateAgent(TEST_AGENT_ID);
    expect(entry((await listAs(TEST_OTLP_KEY)).body, 'auto')?.context_length).toBe(64000);

    await ds.query(`DELETE FROM specificity_assignments WHERE id = 'vml-spec'`);
    app.get(RoutingCacheService).invalidateAgent(TEST_AGENT_ID);
  });

  it('with complexity routing off, is the Default chain only', async () => {
    await setComplexity(TEST_AGENT_ID, false);
    expect(entry((await listAs(TEST_OTLP_KEY)).body, 'auto')?.context_length).toBe(200000);
  });

  it('stays present when the Default has only the legacy auto-assigned route', async () => {
    await setTier(TEST_AGENT_ID, 'default', { auto: route('openai', 'gpt-4o') });
    expect(entry((await listAs(TEST_OTLP_KEY)).body, 'auto')?.context_length).toBe(128000);
  });

  it('is omitted when a Default route window is unknown', async () => {
    await setTier(TEST_AGENT_ID, 'default', {
      override: route('openai', 'gpt-4o'),
      fallbacks: [route('mistral', 'mystery')],
    });
    expect(entry((await listAs(TEST_OTLP_KEY)).body, 'auto')).not.toHaveProperty('context_length');
  });

  afterAll(async () => {
    await setTier(TEST_AGENT_ID, 'default', { override: route('deepseek', 'deepseek-chat') });
  });
});

describe('virtual models in the list', () => {
  const vmIds: Record<string, string> = {};

  beforeAll(async () => {
    const create = async (body: Record<string, unknown>) => {
      const res = await asA(api().post(A_BASE)).send(body).expect(201);
      vmIds[body.name as string] = res.body.id;
    };
    await create({ name: 'deepseek/flash', override_route: { model: 'deepseek-chat' } });
    await create({
      name: 'OpenAI/GPT-4o',
      override_route: { model: 'claude-sonnet-4-5' },
      fallback_routes: [{ model: 'gpt-4o' }],
    });
    await create({
      name: `${CUSTOM_ID.toUpperCase()}/Model-A`,
      override_route: { model: 'gpt-4o' },
    });
    await create({ name: 'mystery-vm', override_route: { model: 'mystery' } });
    await create({ name: 'default-only', continue_on_default: true });
    await create({ name: 'off-vm', override_route: { model: 'gpt-4o' } });
    await asA(api().patch(`${A_BASE}/${vmIds['off-vm']}/toggle`))
      .send({ enabled: false })
      .expect(200);
  });

  it('lists auto, then enabled virtual models in sort order, then unshadowed real models', async () => {
    const res = await listAs(TEST_OTLP_KEY);
    expect(ids(res.body)).toEqual([
      'auto',
      'deepseek/flash',
      'OpenAI/GPT-4o',
      `${CUSTOM_ID.toUpperCase()}/Model-A`,
      'mystery-vm',
      'default-only',
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4-5',
      'deepseek/deepseek-chat',
      'mistral/mystery',
    ]);
    // Shadowed, ignoring case: the public id and custom:<uuid>/<model>
    // of a custom provider without an alias.
    expect(ids(res.body)).not.toContain('openai/gpt-4o');
    expect(ids(res.body)).not.toContain(`${CUSTOM_ID}/model-a`);
  });

  it('follows the harness model listing mode', async () => {
    const LISTING = '/api/v1/routing/test-agent/model-listing';
    const [{ complexity_routing_enabled: complexity }] = await ds.query(
      `SELECT complexity_routing_enabled FROM agents WHERE id = $1`,
      [TEST_AGENT_ID],
    );
    await setComplexity(TEST_AGENT_ID, false);
    try {
      expect((await asA(api().get(LISTING)).expect(200)).body).toEqual({ mode: 'open' });
      await asA(api().patch(LISTING)).send({ mode: 'bogus' }).expect(400);

      await asA(api().patch(LISTING)).send({ mode: 'closed' }).expect(200);
      expect(ids((await listAs(TEST_OTLP_KEY)).body)).toEqual([
        'auto',
        'deepseek/flash',
        'OpenAI/GPT-4o',
        `${CUSTOM_ID.toUpperCase()}/Model-A`,
        'mystery-vm',
        'default-only',
      ]);

      await asA(api().patch(LISTING)).send({ mode: 'restricted' }).expect(200);
      const restricted = ids((await listAs(TEST_OTLP_KEY)).body);
      // Default tier (deepseek-chat) and the virtual models' own routes.
      expect(restricted).toContain('deepseek/deepseek-chat');
      expect(restricted).toContain('anthropic/claude-sonnet-4-5');
      expect(restricted).toContain('mistral/mystery');
      // Not reached by auto nor by any enabled virtual model.
      expect(restricted).not.toContain('openai/gpt-4o-mini');
    } finally {
      await asA(api().patch(LISTING)).send({ mode: 'open' }).expect(200);
      await setComplexity(TEST_AGENT_ID, complexity);
    }
  });

  it('publishes virtual entries as thinker-owned with context_length', async () => {
    const res = await listAs(TEST_OTLP_KEY);
    expect(entry(res.body, 'deepseek/flash')).toEqual({
      id: 'deepseek/flash',
      object: 'model',
      created: 0,
      owned_by: 'thinker',
      context_length: 64000,
    });
    expect(entry(res.body, 'OpenAI/GPT-4o')?.context_length).toBe(128000);
    // Default only through continue_on_default: the Default is deepseek-chat.
    expect(entry(res.body, 'default-only')?.context_length).toBe(64000);
    // Unknown window: omitted, not null.
    expect(entry(res.body, 'mystery-vm')).toEqual({
      id: 'mystery-vm',
      object: 'model',
      created: 0,
      owned_by: 'thinker',
    });
    // Real models never carry context_length.
    expect(entry(res.body, 'deepseek/deepseek-chat')).not.toHaveProperty('context_length');
  });

  it('adds the Default chain to context_length with continue_on_default', async () => {
    await asA(api().put(`${A_BASE}/${vmIds['OpenAI/GPT-4o']}`))
      .send({ continue_on_default: true })
      .expect(200);
    expect(entry((await listAs(TEST_OTLP_KEY)).body, 'OpenAI/GPT-4o')?.context_length).toBe(64000);
    await asA(api().put(`${A_BASE}/${vmIds['OpenAI/GPT-4o']}`))
      .send({ continue_on_default: false })
      .expect(200);
  });

  it('reaches a Default with only the legacy auto-assigned route', async () => {
    await setTier(TEST_AGENT_ID, 'default', { auto: route('openai', 'gpt-4o-mini') });
    expect(entry((await listAs(TEST_OTLP_KEY)).body, 'default-only')?.context_length).toBe(100000);
    await setTier(TEST_AGENT_ID, 'default', { override: route('deepseek', 'deepseek-chat') });
  });

  it('never adds capabilities, cost or route metadata to auto and virtual models', async () => {
    const res = await listAs(TEST_OTLP_KEY, '?capabilities=true&cost=true&route_metadata=true');
    const allowed = ['id', 'object', 'created', 'owned_by', 'context_length'];
    for (const id of ['auto', 'deepseek/flash', 'OpenAI/GPT-4o', 'mystery-vm', 'default-only']) {
      const keys = Object.keys(entry(res.body, id) ?? {});
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.filter((k) => !allowed.includes(k))).toEqual([]);
    }
    expect(entry(res.body, 'deepseek/deepseek-chat')).toMatchObject({
      provider_model_id: 'deepseek-chat',
      auth_type: 'api_key',
      cost: { input: 1, output: 2 },
    });
  });

  it('drops a disabled virtual model and shows the real model again', async () => {
    await asA(api().patch(`${A_BASE}/${vmIds['OpenAI/GPT-4o']}/toggle`))
      .send({ enabled: false })
      .expect(200);
    const res = await listAs(TEST_OTLP_KEY);
    expect(ids(res.body)).not.toContain('OpenAI/GPT-4o');
    expect(ids(res.body)).not.toContain('off-vm');
    expect(ids(res.body)).toContain('openai/gpt-4o');

    await asA(api().patch(`${A_BASE}/${vmIds['OpenAI/GPT-4o']}/toggle`))
      .send({ enabled: true })
      .expect(200);
    expect(ids((await listAs(TEST_OTLP_KEY)).body)).not.toContain('openai/gpt-4o');
  });

  it('follows a reorder', async () => {
    const order = [
      vmIds['mystery-vm'],
      vmIds['deepseek/flash'],
      vmIds['OpenAI/GPT-4o'],
      vmIds[`${CUSTOM_ID.toUpperCase()}/Model-A`],
      vmIds['default-only'],
      vmIds['off-vm'],
    ];
    await asA(api().post(`${A_BASE}/reorder`))
      .send({ ids: order })
      .expect((res) => expect([200, 201]).toContain(res.status));
    expect(ids((await listAs(TEST_OTLP_KEY)).body).slice(0, 3)).toEqual([
      'auto',
      'mystery-vm',
      'deepseek/flash',
    ]);
  });
});

describe('isolation between keys', () => {
  beforeAll(async () => {
    await asA(api().post(SIBLING_BASE))
      .send({ name: 'sibling-vm', override_route: { model: 'gpt-4o-mini' } })
      .expect(201);
    // Same name as an agent A virtual model, in another tenant.
    await asB(api().post(B_BASE))
      .send({ name: 'deepseek/flash', override_route: { model: 'gpt-4o' } })
      .expect(201);
  });

  it('shows each agent key only its own virtual models within a tenant', async () => {
    const a = ids((await listAs(TEST_OTLP_KEY)).body);
    const sibling = ids((await listAs(siblingKey)).body);
    expect(a).toContain('deepseek/flash');
    expect(a).not.toContain('sibling-vm');
    expect(sibling).toContain('sibling-vm');
    expect(sibling).not.toContain('deepseek/flash');
    expect(sibling).not.toContain('OpenAI/GPT-4o');
    // No virtual model of the sibling shadows openai/gpt-4o.
    expect(sibling).toContain('openai/gpt-4o');
  });

  it('shows another tenant key only its own virtual models', async () => {
    const b = (await listAs(bKey)).body;
    const virtuals = b.data.filter((m: ListedModel) => m.owned_by === 'thinker');
    expect(virtuals.map((m: ListedModel) => m.id)).toEqual(['auto', 'deepseek/flash']);
    expect(entry(b, 'deepseek/flash')?.context_length).toBe(128000);
    expect(ids(b)).not.toContain('sibling-vm');
    expect(ids(b)).toContain('openai/gpt-4o');
    // Agent A keeps its own definition of the same name.
    expect(entry((await listAs(TEST_OTLP_KEY)).body, 'deepseek/flash')?.context_length).toBe(64000);
  });
});
