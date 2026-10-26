/**
 * Admin API for virtual models (ADR 0004, PR 1): CRUD, strict route
 * validation, computed `shadows` / `context_length`, model-params cleanup on
 * delete, and isolation between agents and tenants. No proxy behavior here.
 *
 * Discovery is stubbed in the app (no provider APIs in e2e), so the agent's
 * catalog and provider keys come from spies on the real services.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { ModelRoute } from 'thinker-shared';
import { createTestApp, TEST_AGENT_ID, TEST_API_KEY, TEST_TENANT_ID } from './helpers';
import { ModelDiscoveryService } from '../src/model-discovery/model-discovery.service';
import type { DiscoveredModel } from '../src/model-discovery/model-fetcher';
import { ProviderKeyService } from '../src/routing/routing-core/provider-key.service';
import { RoutingCacheService } from '../src/routing/routing-core/routing-cache.service';

let app: INestApplication;
let ds: DataSource;

const BASE = '/api/v1/routing/test-agent/virtual-models';
const OTHER_AGENT_ID = 'vm-other-agent';
const OTHER_BASE = '/api/v1/routing/vm-other/virtual-models';
const USER_B = 'vm-user-b';
const B_AGENT_NAME = 'vm-b-agent';
const B_BASE = `/api/v1/routing/${B_AGENT_NAME}/virtual-models`;

const api = () => request(app.getHttpServer());
const asA = (r: request.Test) => r.set('x-api-key', TEST_API_KEY);
const asB = (r: request.Test) => r.set('x-api-key', TEST_API_KEY).set('x-test-user-id', USER_B);

const model = (id: string, provider: string, contextWindow: number): DiscoveredModel =>
  ({
    id,
    displayName: id,
    provider,
    contextWindow,
    inputPricePerToken: 0,
    outputPricePerToken: 0,
    capabilityReasoning: false,
    capabilityCode: false,
    qualityScore: 3,
    authType: 'api_key',
  }) as DiscoveredModel;

const CATALOG: DiscoveredModel[] = [
  model('gpt-4o', 'openai', 128000),
  model('gpt-4o-mini', 'openai', 128000),
  model('claude-sonnet-4-5', 'anthropic', 200000),
  model('deepseek-chat', 'deepseek', 64000),
  model('mystery', 'mistral', 0),
];

const route = (provider: string, m: string, keyLabel?: string): ModelRoute =>
  keyLabel
    ? { provider, authType: 'api_key', model: m, keyLabel }
    : { provider, authType: 'api_key', model: m };

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);
  const now = new Date().toISOString();

  jest.spyOn(app.get(ModelDiscoveryService), 'getModelsForAgent').mockResolvedValue(CATALOG);
  jest.spyOn(app.get(ProviderKeyService), 'getProviderKeys').mockResolvedValue([
    { id: 'k1', label: 'Default', priority: 0, apiKey: 'sk-1', region: null },
    { id: 'k2', label: 'Work', priority: 1, apiKey: 'sk-2', region: null },
  ]);

  await ds.query(
    `INSERT INTO agents (id, name, display_name, is_active, complexity_routing_enabled, tenant_id, created_at, updated_at)
     VALUES ($1, 'vm-other', 'Other', true, false, $2, $3, $3)`,
    [OTHER_AGENT_ID, TEST_TENANT_ID, now],
  );
  await asB(api().post('/api/v1/agents')).send({ name: B_AGENT_NAME }).expect(201);
}, 60000);

afterAll(async () => {
  jest.restoreAllMocks();
  await app.close();
});

function createVm(body: Record<string, unknown>, base = BASE, as = asA): request.Test {
  return as(api().post(base)).send(body);
}

describe('create and list', () => {
  let vmId: string;

  it('creates a virtual model with resolved routes and computed fields', async () => {
    const res = await createVm({
      name: 'Claude-Sonnet-4-5',
      override_route: { model: 'anthropic/claude-sonnet-4-5' },
      fallback_routes: [{ model: 'gpt-4o', keyLabel: 'work' }],
    }).expect(201);
    vmId = res.body.id;
    expect(res.body).toMatchObject({
      agent_id: TEST_AGENT_ID,
      name: 'Claude-Sonnet-4-5',
      sort_order: 0,
      enabled: true,
      continue_on_default: false,
      response_mode: 'buffered',
      output_modality: 'text',
      override_route: route('anthropic', 'claude-sonnet-4-5'),
      fallback_routes: [route('openai', 'gpt-4o', 'Work')],
      shadows: ['claude-sonnet-4-5'],
      context_length: 128000,
    });
    expect(res.body).not.toHaveProperty('tenant_id');
    // No key label sent for the primary: none stored (picked per request).
    expect(res.body.override_route).not.toHaveProperty('keyLabel');

    const rows = await ds.query(`SELECT tenant_id, agent_id FROM virtual_models WHERE id = $1`, [
      vmId,
    ]);
    expect(rows).toEqual([{ tenant_id: TEST_TENANT_ID, agent_id: TEST_AGENT_ID }]);
  });

  it('lists the agent virtual models in sort order with shadows and context_length', async () => {
    await createVm({ name: 'deepseek/flash', override_route: { model: 'deepseek-chat' } }).expect(
      201,
    );
    const res = await asA(api().get(BASE)).expect(200);
    expect(res.body.map((v: { name: string }) => v.name)).toEqual([
      'Claude-Sonnet-4-5',
      'deepseek/flash',
    ]);
    expect(res.body[1]).toMatchObject({ sort_order: 1, shadows: [], context_length: 64000 });
  });

  it('omits context_length (null) when a route window is unknown', async () => {
    const res = await createVm({ name: 'mystery-vm', override_route: { model: 'mystery' } }).expect(
      201,
    );
    expect(res.body.context_length).toBeNull();
    await asA(api().delete(`${BASE}/${res.body.id}`)).expect(200);
  });

  it('adds the Default chain to context_length with continue_on_default', async () => {
    await ds.query(
      `INSERT INTO tier_assignments (id, agent_id, tier, override_route, updated_at)
       VALUES ('vm-tier-default', $1, 'default', $2::jsonb, now())
       ON CONFLICT (agent_id, tier) DO UPDATE SET override_route = EXCLUDED.override_route`,
      [TEST_AGENT_ID, JSON.stringify(route('deepseek', 'deepseek-chat'))],
    );
    app.get(RoutingCacheService).invalidateAgent(TEST_AGENT_ID);
    const res = await asA(api().put(`${BASE}/${vmId}`))
      .send({ continue_on_default: true })
      .expect(200);
    expect(res.body).toMatchObject({ continue_on_default: true, context_length: 64000 });
  });
});

describe('name validation', () => {
  it.each(['/lead', 'trail/', 'a//b', 'has space', 'a'.repeat(65)])(
    'rejects %j with a 400',
    async (name) => {
      await createVm({ name }).expect(400);
    },
  );

  it.each(['auto', 'AUTO', 'Auto'])('reserves %j', async (name) => {
    const res = await createVm({ name }).expect(400);
    expect(res.body.message).toContain('reserved');
  });

  it('rejects a duplicate ignoring case, disabled ones included, with a readable 409', async () => {
    const created = await createVm({ name: 'dup/name' }).expect(201);
    await asA(api().patch(`${BASE}/${created.body.id}/toggle`))
      .send({ enabled: false })
      .expect(200);
    const res = await createVm({ name: 'DUP/Name' }).expect(409);
    expect(res.body.message).toContain('already exists');
    const rename = await createVm({ name: 'dup-two' }).expect(201);
    await asA(api().put(`${BASE}/${rename.body.id}`))
      .send({ name: 'Dup/Name' })
      .expect(409);
  });

  it('rejects unknown fields', async () => {
    await createVm({ name: 'x', header_key: 'x-foo' }).expect(400);
  });
});

describe('strict route validation', () => {
  it('rejects a primary that does not resolve to an enabled provider', async () => {
    const res = await createVm({
      name: 'bad-primary',
      override_route: { model: 'gpt-4o', provider: 'groq', authType: 'api_key' },
    }).expect(400);
    expect(res.body.message).toContain('gpt-4o');
    const rows = await ds.query(`SELECT 1 FROM virtual_models WHERE name = 'bad-primary'`);
    expect(rows).toHaveLength(0);
  });

  it('rejects an unknown fallback model', async () => {
    const res = await createVm({
      name: 'bad-fallback',
      override_route: { model: 'gpt-4o' },
      fallback_routes: [{ model: 'not-a-model' }],
    }).expect(400);
    expect(res.body.message).toContain('not-a-model');
  });

  it('rejects a key label that does not exist for the provider', async () => {
    const res = await createVm({
      name: 'bad-key',
      override_route: { model: 'gpt-4o', keyLabel: 'Personal' },
    }).expect(400);
    expect(res.body.message).toContain('Personal');
  });

  it('rejects more than 5 fallbacks', async () => {
    await createVm({
      name: 'too-many',
      fallback_routes: Array.from({ length: 6 }, () => ({ model: 'gpt-4o' })),
    }).expect(400);
  });
});

describe('editing a virtual model', () => {
  let id: string;

  beforeAll(async () => {
    const res = await createVm({ name: 'editable' }).expect(201);
    id = res.body.id;
  });

  it('sets and clears the primary', async () => {
    const set = await asA(api().put(`${BASE}/${id}/override`))
      .send({ model: 'gpt-4o', providerKeyLabel: 'Default' })
      .expect(200);
    expect(set.body.override_route).toEqual(route('openai', 'gpt-4o', 'Default'));
    await asA(api().put(`${BASE}/${id}/override`))
      .send({ model: 'ghost-model' })
      .expect(400);
    await asA(api().delete(`${BASE}/${id}/override`)).expect(200);
    const list = await asA(api().get(BASE)).expect(200);
    expect(list.body.find((v: { id: string }) => v.id === id).override_route).toBeNull();
  });

  it('sets, caps and clears fallbacks', async () => {
    await asA(api().put(`${BASE}/${id}/override`))
      .send({ model: 'gpt-4o' })
      .expect(200);
    const set = await asA(api().put(`${BASE}/${id}/fallbacks`))
      .send({ models: ['gpt-4o-mini', 'deepseek-chat'] })
      .expect(200);
    expect(set.body).toEqual([route('openai', 'gpt-4o-mini'), route('deepseek', 'deepseek-chat')]);
    await asA(api().put(`${BASE}/${id}/fallbacks`))
      .send({ models: Array(6).fill('gpt-4o-mini') })
      .expect(400);
    await asA(api().delete(`${BASE}/${id}/fallbacks`)).expect(200);
  });

  it('changes the response mode and toggles', async () => {
    const mode = await asA(api().patch(`${BASE}/${id}/response-mode`))
      .send({ response_mode: 'stream' })
      .expect(200);
    expect(mode.body.response_mode).toBe('stream');
    await asA(api().patch(`${BASE}/${id}/response-mode`))
      .send({})
      .expect(400);
    const off = await asA(api().patch(`${BASE}/${id}/toggle`))
      .send({ enabled: false })
      .expect(200);
    expect(off.body.enabled).toBe(false);
  });

  it('reorders every virtual model of the agent', async () => {
    const list = await asA(api().get(BASE)).expect(200);
    const ids: string[] = list.body.map((v: { id: string }) => v.id).reverse();
    await asA(api().post(`${BASE}/reorder`))
      .send({ ids })
      .expect(201);
    const after = await asA(api().get(BASE)).expect(200);
    expect(after.body.map((v: { id: string }) => v.id)).toEqual(ids);
    await asA(api().post(`${BASE}/reorder`))
      .send({ ids: ids.slice(1) })
      .expect(400);
  });
});

describe('delete', () => {
  it('deletes the virtual model and only its virtual:<id> model params', async () => {
    const res = await createVm({ name: 'to-delete', override_route: { model: 'gpt-4o' } }).expect(
      201,
    );
    const id = res.body.id as string;
    for (const scope of [`virtual:${id}`, 'tier:default']) {
      await asA(api().put('/api/v1/routing/test-agent/model-params'))
        .send({
          scope,
          provider: 'openai',
          authType: 'api_key',
          model: 'gpt-4o',
          params: { temperature: 0.2 },
        })
        .expect(200);
    }

    await asA(api().delete(`${BASE}/${id}`)).expect(200);

    expect(await ds.query(`SELECT 1 FROM virtual_models WHERE id = $1`, [id])).toHaveLength(0);
    const params: Array<{ scope_key: string }> = await ds.query(
      `SELECT scope_key FROM agent_model_params WHERE agent_id = $1 ORDER BY scope_key`,
      [TEST_AGENT_ID],
    );
    expect(params.map((p) => p.scope_key)).toEqual(['tier:default']);
    await asA(api().delete(`${BASE}/${id}`)).expect(404);
  });
});

describe('isolation', () => {
  let aId: string;

  beforeAll(async () => {
    const res = await createVm({ name: 'private-a' }).expect(201);
    aId = res.body.id;
  });

  it('keeps virtual models per agent: another agent neither lists nor reaches them', async () => {
    const other = await asA(api().get(OTHER_BASE)).expect(200);
    expect(other.body).toEqual([]);
    await asA(api().patch(`${OTHER_BASE}/${aId}/toggle`))
      .send({ enabled: false })
      .expect(404);
    await asA(api().put(`${OTHER_BASE}/${aId}`))
      .send({ name: 'stolen' })
      .expect(404);
    await asA(api().delete(`${OTHER_BASE}/${aId}`)).expect(404);
    // The same name is free on another agent.
    await createVm({ name: 'private-a' }, OTHER_BASE).expect(201);
  });

  it("never lets another tenant read or change tenant A's virtual models", async () => {
    await asB(api().get(BASE)).expect(404);
    await asB(api().post(BASE)).send({ name: 'intrude' }).expect(404);
    const own = await asB(api().get(B_BASE)).expect(200);
    expect(own.body).toEqual([]);
    await asB(api().patch(`${B_BASE}/${aId}/toggle`))
      .send({ enabled: false })
      .expect(404);
    await asB(api().put(`${B_BASE}/${aId}/override`))
      .send({ model: 'gpt-4o' })
      .expect(404);
    await asB(api().delete(`${B_BASE}/${aId}`)).expect(404);
    const row = await ds.query(`SELECT enabled FROM virtual_models WHERE id = $1`, [aId]);
    expect(row).toEqual([{ enabled: true }]);
  });

  it('keeps a reorder from touching another agent', async () => {
    await asA(api().post(`${OTHER_BASE}/reorder`))
      .send({ ids: [aId] })
      .expect(400);
  });
});
