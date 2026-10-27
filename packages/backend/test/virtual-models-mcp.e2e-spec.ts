/**
 * Virtual models through the MCP routing tools (ADR 0004, PR 5), against the
 * real services and database: the tools must reach exactly what the admin
 * API does (strict route validation, 409 on a duplicate name, params under
 * the `virtual:<id>` scope, cleanup on delete, tenant isolation), and the
 * virtual-model params REST endpoint the CLI uses must read the same rows.
 *
 * The remote MCP endpoint itself needs an OAuth token and is not mounted in
 * the e2e app, so the tools are registered on a capturing server with deps
 * taken from the app, the same objects `McpController` hands them.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { McpServer } from '@modelcontextprotocol/server';
import { createTestApp, TEST_AGENT_ID, TEST_API_KEY, TEST_TENANT_ID } from './helpers';
import { ModelDiscoveryService } from '../src/model-discovery/model-discovery.service';
import type { DiscoveredModel } from '../src/model-discovery/model-fetcher';
import { ProviderKeyService } from '../src/routing/routing-core/provider-key.service';
import { RoutingCacheService } from '../src/routing/routing-core/routing-cache.service';
import { ResolveAgentService } from '../src/routing/routing-core/resolve-agent.service';
import { ProviderService } from '../src/routing/routing-core/provider.service';
import { TierService } from '../src/routing/routing-core/tier.service';
import { HeaderTierService } from '../src/routing/header-tiers/header-tier.service';
import { VirtualModelService } from '../src/routing/virtual-models/virtual-model.service';
import { RouteModelParamsService } from '../src/routing/model-params/route-model-params.service';
import type { McpOperator } from '../src/mcp/mcp-auth';
import type { McpToolDeps } from '../src/mcp/tool-deps';
import { registerRoutingTools } from '../src/mcp/tools/routing.tools';

// The routing tools read the server origin from the auth instance, which is
// ESM-only and does not load under Jest. Only `thinker_routing_test` uses the
// origin, and this spec never calls it; nothing else here needs the instance
// (the e2e app authenticates with its mock guard).
jest.mock('../src/auth/auth.instance', () => ({ authOrigin: 'http://127.0.0.1:9' }));

let app: INestApplication;
let ds: DataSource;

const BASE = '/api/v1/routing/test-agent';
const OTHER_TENANT = 'vm-mcp-tenant-b';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

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
  model('deepseek-chat', 'deepseek', 64000),
  // A custom provider published under its alias as `fake2/deepseek-chat`.
  {
    ...model('custom:cp-1/deepseek-chat', 'custom:cp-1', 128000),
    providerAlias: 'fake2',
  } as DiscoveredModel,
];

function operator(tenantId = TEST_TENANT_ID): McpOperator {
  return {
    userId: 'mcp-user',
    tenantId,
    scopes: new Set(['mcp:read', 'mcp:write']),
    role: 'owner',
  };
}

function tools(op = operator()): Map<string, Handler> {
  const registered = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      registered.set(name, handler);
    },
  } as unknown as McpServer;
  const deps = {
    resolveAgent: app.get(ResolveAgentService),
    providers: app.get(ProviderService),
    tiers: app.get(TierService),
    headerTiers: app.get(HeaderTierService),
    virtualModels: app.get(VirtualModelService),
    routeModelParams: app.get(RouteModelParamsService),
    pricingSync: { getAll: () => new Map([['gpt-4o', {}]]) },
  } as unknown as McpToolDeps;
  registerRoutingTools(server, deps, op);
  return registered;
}

async function call(
  name: string,
  args: Record<string, unknown>,
  op?: McpOperator,
): Promise<{ data: unknown; error: boolean; text: string }> {
  const handler = tools(op).get(name);
  if (!handler) throw new Error(`no tool ${name}`);
  const res = (await handler(args)) as { content: { text: string }[]; isError?: boolean };
  const text = res.content[0].text;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { data, error: res.isError === true, text };
}

const api = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);
  jest.spyOn(app.get(ModelDiscoveryService), 'getModelsForAgent').mockResolvedValue(CATALOG);
  jest
    .spyOn(app.get(ProviderKeyService), 'getProviderKeys')
    .mockResolvedValue([{ id: 'k1', label: 'Default', priority: 0, apiKey: 'sk', region: null }]);

  const now = new Date().toISOString();
  await ds.query(
    `INSERT INTO tier_assignments (id, agent_id, tier, override_route, updated_at)
     VALUES ('vm-mcp-default', $1, 'default', $2::jsonb, now())
     ON CONFLICT (agent_id, tier) DO UPDATE SET override_route = EXCLUDED.override_route`,
    [TEST_AGENT_ID, JSON.stringify({ provider: 'openai', authType: 'api_key', model: 'gpt-4o' })],
  );
  // A custom tier with the same name as a virtual model created below: the
  // `virtual` selector must never write to it.
  await ds.query(
    `INSERT INTO header_tiers (id, tenant_id, agent_id, name, header_key, header_value, badge_color, override_route)
     VALUES ('vm-mcp-ht', $1, $2, 'Deep', 'x-thinker-tier', 'deep', 'indigo', $3::jsonb)`,
    [
      TEST_TENANT_ID,
      TEST_AGENT_ID,
      JSON.stringify({ provider: 'deepseek', authType: 'api_key', model: 'deepseek-chat' }),
    ],
  );
  await ds.query(
    `INSERT INTO tenants (id, name, owner_user_id, organization_name, is_active, created_at, updated_at)
     VALUES ($1, $1, 'vm-mcp-user-b', 'B', true, $2, $2)`,
    [OTHER_TENANT, now],
  );
  app.get(RoutingCacheService).invalidateAgent(TEST_AGENT_ID);
}, 60000);

afterAll(async () => {
  jest.restoreAllMocks();
  await app.close();
});

describe('MCP virtual model tools', () => {
  let deepId: string;

  it('creates a virtual model with a validated chain', async () => {
    const res = await call('thinker_routing_virtual_create', {
      agent: 'test-agent',
      name: 'Deep',
      model: 'deepseek/deepseek-chat',
      fallbacks: ['gpt-4o-mini'],
      continue_on_default: true,
    });
    expect(res.error).toBe(false);
    const vm = (res.data as { virtual_model: Record<string, unknown> }).virtual_model;
    expect(vm).toMatchObject({
      name: 'Deep',
      enabled: true,
      continue_on_default: true,
      override_route: { provider: 'deepseek', authType: 'api_key', model: 'deepseek-chat' },
      fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o-mini' }],
      context_length: 64000,
    });
    deepId = vm['id'] as string;
    const rows = await ds.query(`SELECT tenant_id, agent_id FROM virtual_models WHERE id = $1`, [
      deepId,
    ]);
    expect(rows).toEqual([{ tenant_id: TEST_TENANT_ID, agent_id: TEST_AGENT_ID }]);
  });

  it('rejects a duplicate name ignoring case and an unroutable model, persisting nothing', async () => {
    const dup = await call('thinker_routing_virtual_create', { agent: 'test-agent', name: 'DEEP' });
    expect(dup.error).toBe(true);
    expect(dup.text).toContain('already exists');

    const bad = await call('thinker_routing_virtual_create', {
      agent: 'test-agent',
      name: 'ghost',
      model: 'no-such-model',
    });
    expect(bad.error).toBe(true);
    expect(bad.text).toContain('no-such-model');

    const reserved = await call('thinker_routing_virtual_create', {
      agent: 'test-agent',
      name: 'Auto',
    });
    expect(reserved.error).toBe(true);

    const rows = await ds.query(`SELECT name FROM virtual_models WHERE agent_id = $1`, [
      TEST_AGENT_ID,
    ]);
    expect(rows).toEqual([{ name: 'Deep' }]);
  });

  it('lists the virtual models, and the status lists them too', async () => {
    const list = await call('thinker_routing_virtual_list', { agent: 'test-agent' });
    expect((list.data as { virtual_models: unknown[] }).virtual_models).toEqual([
      expect.objectContaining({ id: deepId, name: 'Deep', shadows: [] }),
    ]);

    const status = await call('thinker_routing_status', { agent: 'test-agent' });
    expect(status.data).toMatchObject({
      virtual_models: [
        {
          id: deepId,
          name: 'Deep',
          enabled: true,
          route: { model: 'deepseek-chat' },
          fallbacks: [{ model: 'gpt-4o-mini' }],
          continue_on_default: true,
          response_mode: 'buffered',
        },
      ],
    });
    // No provider is connected in the e2e app: nothing routes.
    expect(status.data).toMatchObject({
      status_for: 'auto',
      enabled: false,
      reason: 'no_provider',
      routes_by_virtual_model: false,
      active_virtual_models: [],
    });
  });

  it('tells a harness that routes only through virtual models from one that cannot route', async () => {
    jest
      .spyOn(app.get(ProviderService), 'getProviders')
      .mockResolvedValue([{ is_active: true }] as never);
    const routable = jest.spyOn(app.get(TierService), 'hasRoutableTier');
    try {
      routable.mockResolvedValue(false);
      const onlyVirtual = await call('thinker_routing_status', { agent: 'test-agent' });
      expect(onlyVirtual.data).toMatchObject({
        status_for: 'auto',
        enabled: false,
        reason: 'auto_not_routable',
        auto_reason: 'no_routable_models',
        routes_by_virtual_model: true,
        active_virtual_models: ['Deep'],
      });

      routable.mockResolvedValue(true);
      const both = await call('thinker_routing_status', { agent: 'test-agent' });
      expect(both.data).toMatchObject({
        enabled: true,
        reason: null,
        routes_by_virtual_model: true,
        active_virtual_models: ['Deep'],
      });
      expect(both.data).not.toHaveProperty('auto_reason');
    } finally {
      jest.mocked(app.get(ProviderService).getProviders).mockRestore();
      routable.mockRestore();
    }
  });

  it('appends only the default slot for continue_on_default, as the proxy does', async () => {
    const created = await call('thinker_routing_virtual_create', {
      agent: 'test-agent',
      name: 'onDefault',
      continue_on_default: true,
    });
    expect(created.error).toBe(false);
    const id = (created.data as { virtual_model: { id: string } }).virtual_model.id;
    jest
      .spyOn(app.get(ProviderService), 'getProviders')
      .mockResolvedValue([{ is_active: true }] as never);
    const cache = app.get(RoutingCacheService);
    try {
      // Default slot routes: the virtual model continues on it.
      let status = await call('thinker_routing_status', { agent: 'test-agent' });
      expect((status.data as { active_virtual_models: string[] }).active_virtual_models).toEqual([
        'Deep',
        'onDefault',
      ]);

      // Empty default slot while another slot has a route: hasRoutableTier
      // may say yes, but the proxy appends nothing, so it does not count.
      await ds.query(
        `UPDATE tier_assignments SET override_route = NULL, auto_assigned_route = NULL, fallback_routes = NULL
         WHERE agent_id = $1 AND tier = 'default'`,
        [TEST_AGENT_ID],
      );
      await ds.query(
        `INSERT INTO tier_assignments (id, agent_id, tier, override_route, updated_at)
         VALUES ('vm-mcp-simple', $1, 'simple', $2::jsonb, now())
         ON CONFLICT (agent_id, tier) DO UPDATE SET override_route = EXCLUDED.override_route`,
        [
          TEST_AGENT_ID,
          JSON.stringify({ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }),
        ],
      );
      cache.invalidateAgent(TEST_AGENT_ID);
      status = await call('thinker_routing_status', { agent: 'test-agent' });
      expect(status.data).toMatchObject({ active_virtual_models: ['Deep'] });
      const views = await api()
        .get(`${BASE}/virtual-models`)
        .set('x-api-key', TEST_API_KEY)
        .expect(200);
      expect(views.body.find((v: { id: string }) => v.id === id)).toMatchObject({
        routable: false,
      });
    } finally {
      jest.mocked(app.get(ProviderService).getProviders).mockRestore();
      await ds.query(
        `UPDATE tier_assignments SET override_route = $2::jsonb WHERE agent_id = $1 AND tier = 'default'`,
        [
          TEST_AGENT_ID,
          JSON.stringify({ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }),
        ],
      );
      await ds.query(`DELETE FROM tier_assignments WHERE id = 'vm-mcp-simple'`);
      await call('thinker_routing_virtual_delete', { agent: 'test-agent', virtual: id });
      cache.invalidateAgent(TEST_AGENT_ID);
    }
  });

  it('sets params under virtual:<id>, apart from the custom tier of the same name', async () => {
    const set = await call('thinker_routing_params_set', {
      agent: 'test-agent',
      virtual: 'deep',
      model: 'gpt-4o-mini',
      set: { temperature: 0.3 },
    });
    expect(set.error).toBe(false);
    expect(set.data).toMatchObject({
      virtual: 'Deep',
      route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o-mini' },
      models: ['deepseek-chat', 'gpt-4o-mini'],
    });

    const rows = await ds.query(
      `SELECT scope_key, model_name, params FROM agent_model_params WHERE agent_id = $1`,
      [TEST_AGENT_ID],
    );
    expect(rows).toEqual([
      { scope_key: `virtual:${deepId}`, model_name: 'gpt-4o-mini', params: { temperature: 0.3 } },
    ]);

    const tier = await call('thinker_routing_params_get', { agent: 'test-agent', tier: 'deep' });
    expect(tier.data).toMatchObject({ tier: 'Deep', route: { model: 'deepseek-chat' } });

    const both = await call('thinker_routing_params_get', {
      agent: 'test-agent',
      tier: 'deep',
      virtual: 'deep',
    });
    expect(both).toMatchObject({ error: true, text: 'Pass tier or virtual, not both' });
  });

  it('serves the same rows through the virtual-model params REST endpoint', async () => {
    const res = await api()
      .get(`${BASE}/virtual-model-params`)
      .query({ virtual: 'DEEP', model: 'gpt-4o-mini' })
      .set('x-api-key', TEST_API_KEY)
      .expect(200);
    expect(res.body).toMatchObject({ virtual: 'Deep', route: { model: 'gpt-4o-mini' } });
    expect(res.body).not.toHaveProperty('tier');
    expect(res.body.params.find((p: { path: string }) => p.path === 'temperature').current).toBe(
      0.3,
    );

    const patched = await api()
      .patch(`${BASE}/virtual-model-params`)
      .query({ virtual: 'deep', model: 'gpt-4o-mini' })
      .set('x-api-key', TEST_API_KEY)
      .send({ set: { temperature: 0.5 } })
      .expect(200);
    expect(
      patched.body.params.find((p: { path: string }) => p.path === 'temperature').current,
    ).toBe(0.5);
    const [saved] = await ds.query(
      `SELECT params FROM agent_model_params WHERE agent_id = $1 AND scope_key = $2`,
      [TEST_AGENT_ID, `virtual:${deepId}`],
    );
    expect(saved.params).toEqual({ temperature: 0.5 });

    await api()
      .get(`${BASE}/virtual-model-params`)
      .query({ virtual: 'nope' })
      .set('x-api-key', TEST_API_KEY)
      .expect(404);
    await api().get(`${BASE}/virtual-model-params`).set('x-api-key', TEST_API_KEY).expect(400);
  });

  it('accepts the virtual:<id> scope on the scope-keyed endpoint', async () => {
    await api()
      .put(`${BASE}/model-params`)
      .set('x-api-key', TEST_API_KEY)
      .send({
        scope: `virtual:${deepId}`,
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o-mini',
        params: { temperature: 0.9 },
      })
      .expect(200);
    const res = await api()
      .get(`${BASE}/virtual-model-params`)
      .query({ virtual: 'deep', model: 'gpt-4o-mini' })
      .set('x-api-key', TEST_API_KEY)
      .expect(200);
    expect(res.body.params.find((p: { path: string }) => p.path === 'temperature').current).toBe(
      0.9,
    );
  });

  it('updates a virtual model by name: rename, chain, flags', async () => {
    const res = await call('thinker_routing_virtual_update', {
      agent: 'test-agent',
      virtual: 'deep',
      name: 'deepseek/flash',
      model: 'gpt-4o',
      fallbacks: [],
      continue_on_default: false,
      enabled: false,
    });
    expect(res.error).toBe(false);
    expect((res.data as { virtual_model: unknown }).virtual_model).toMatchObject({
      id: deepId,
      name: 'deepseek/flash',
      enabled: false,
      continue_on_default: false,
      override_route: { model: 'gpt-4o' },
      fallback_routes: null,
    });

    const bad = await call('thinker_routing_virtual_update', {
      agent: 'test-agent',
      virtual: 'deepseek/flash',
      model: 'no-such-model',
    });
    expect(bad.error).toBe(true);
    const [row] = await ds.query(`SELECT override_route FROM virtual_models WHERE id = $1`, [
      deepId,
    ]);
    expect(row.override_route).toMatchObject({ model: 'gpt-4o' });
  });

  it('keeps one tenant out of another tenant’s virtual models', async () => {
    const other = operator(OTHER_TENANT);
    const list = await call('thinker_routing_virtual_list', { agent: 'test-agent' }, other);
    expect(list.error).toBe(true);
    const del = await call(
      'thinker_routing_virtual_delete',
      { agent: 'test-agent', virtual: deepId },
      other,
    );
    expect(del.error).toBe(true);
    const params = await call(
      'thinker_routing_params_get',
      { agent: 'test-agent', virtual: 'deepseek/flash' },
      other,
    );
    expect(params.error).toBe(true);
    const rows = await ds.query(`SELECT id FROM virtual_models WHERE id = $1`, [deepId]);
    expect(rows).toHaveLength(1);
  });

  it('deletes a virtual model and its params', async () => {
    const res = await call('thinker_routing_virtual_delete', {
      agent: 'test-agent',
      virtual: 'DEEPSEEK/FLASH',
    });
    expect(res.data).toEqual({ ok: true, deleted: { id: deepId, name: 'deepseek/flash' } });
    expect(await ds.query(`SELECT id FROM virtual_models WHERE id = $1`, [deepId])).toEqual([]);
    expect(
      await ds.query(`SELECT id FROM agent_model_params WHERE scope_key = $1`, [
        `virtual:${deepId}`,
      ]),
    ).toEqual([]);

    const gone = await call('thinker_routing_virtual_delete', {
      agent: 'test-agent',
      virtual: 'deepseek/flash',
    });
    expect(gone).toMatchObject({
      error: true,
      text: 'Virtual model "deepseek/flash" not found for "test-agent" (it has no virtual models)',
    });
  });

  it('addresses a model of the chain by its public or native id', async () => {
    const created = await call('thinker_routing_virtual_create', {
      agent: 'test-agent',
      name: 'aliased',
      model: 'fake2/deepseek-chat',
      fallbacks: ['deepseek/deepseek-chat'],
    });
    expect(created.error).toBe(false);
    expect(created.data).toMatchObject({
      virtual_model: {
        override_route: { provider: 'custom:cp-1', model: 'custom:cp-1/deepseek-chat' },
        fallback_routes: [{ provider: 'deepseek', model: 'deepseek-chat' }],
      },
    });

    const byPublic = await api()
      .get(`${BASE}/virtual-model-params`)
      .query({ virtual: 'aliased', model: 'fake2/deepseek-chat' })
      .set('x-api-key', TEST_API_KEY)
      .expect(200);
    expect(byPublic.body).toMatchObject({
      route: { provider: 'custom:cp-1', model: 'custom:cp-1/deepseek-chat' },
      public_model: 'fake2/deepseek-chat',
      models: ['custom:cp-1/deepseek-chat', 'deepseek-chat'],
      public_models: ['fake2/deepseek-chat', 'deepseek/deepseek-chat'],
    });

    const byStored = await call('thinker_routing_params_get', {
      agent: 'test-agent',
      virtual: 'aliased',
      model: 'custom:cp-1/deepseek-chat',
    });
    expect(byStored.data).toMatchObject({ public_model: 'fake2/deepseek-chat' });

    // The bare id is the deepseek route's stored id, so it wins over the
    // custom route's derived native name.
    const bare = await call('thinker_routing_params_get', {
      agent: 'test-agent',
      virtual: 'aliased',
      model: 'deepseek-chat',
    });
    expect(bare.data).toMatchObject({ route: { provider: 'deepseek', model: 'deepseek-chat' } });

    const native = await call('thinker_routing_params_set', {
      agent: 'test-agent',
      virtual: 'aliased',
      model: 'deepseek/deepseek-chat',
      set: { temperature: 0.4 },
    });
    expect(native.error).toBe(false);
    const rows = await ds.query(
      `SELECT provider, model_name FROM agent_model_params WHERE agent_id = $1 AND scope_key LIKE 'virtual:%'`,
      [TEST_AGENT_ID],
    );
    expect(rows).toEqual([{ provider: 'deepseek', model_name: 'deepseek-chat' }]);
  });
});
