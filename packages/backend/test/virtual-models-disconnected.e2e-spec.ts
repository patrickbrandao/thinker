/**
 * Virtual models whose routes belong to a provider the agent no longer has
 * (issue #197, ADR 0004 section 7). The proxy finds such a route unavailable
 * (ProviderKeyService.isRouteAvailable, credential-row fallback) and answers
 * M301, so every status surface must agree:
 * - the admin listing reports `routable: false`;
 * - `thinker_routing_status` leaves the virtual model out of
 *   `active_virtual_models` (and `routes_by_virtual_model` follows);
 * - the route stops counting toward `context_length` in the listing and in
 *   `GET /v1/models`.
 * A connected provider whose discovery has no models yet (cold discovery)
 * keeps counting as available, with an unknown window.
 *
 * Providers are connected through the real API. Disabling or disconnecting a
 * provider a virtual model routes to is now blocked with 409, so the dangling
 * state (rows left by an older version, or a provider deactivated outside the
 * API) is reproduced straight in the database after asserting the 409. Model
 * discovery is stubbed to follow the database: the agent's catalog lists the
 * models of its active, enabled providers, except those marked cold.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  createTestApp,
  TEST_AGENT_ID,
  TEST_API_KEY,
  TEST_OTLP_KEY,
  TEST_TENANT_ID,
} from './helpers';
import { ModelDiscoveryService } from '../src/model-discovery/model-discovery.service';
import type { DiscoveredModel } from '../src/model-discovery/model-fetcher';
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

// See virtual-models-mcp.e2e-spec.ts: the auth instance is ESM-only and only
// `thinker_routing_test` reads the origin, which this spec never calls.
jest.mock('../src/auth/auth.instance', () => ({ authOrigin: 'http://127.0.0.1:9' }));

let app: INestApplication;
let ds: DataSource;

const ROUTING = '/api/v1/routing/test-agent';
const VM_BASE = `${ROUTING}/virtual-models`;

const model = (id: string, provider: string, contextWindow: number): DiscoveredModel =>
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
  }) as DiscoveredModel;

const MODELS: DiscoveredModel[] = [
  model('gpt-4o', 'openai', 128000),
  model('deepseek-chat', 'deepseek', 64000),
];

/** Connected providers whose discovery has returned no models yet. */
const cold = new Set<string>();

const api = () => request(app.getHttpServer());
const admin = (r: request.Test) => r.set('x-api-key', TEST_API_KEY);

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

function routingStatus(): Promise<Record<string, unknown>> {
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
  const op: McpOperator = {
    userId: 'mcp-user',
    tenantId: TEST_TENANT_ID,
    scopes: new Set(['mcp:read']),
  };
  registerRoutingTools(server, deps, op);
  return registered.get('thinker_routing_status')!({ agent: 'test-agent' }).then((res) =>
    JSON.parse((res as { content: { text: string }[] }).content[0].text),
  );
}

interface View {
  name: string;
  routable: boolean;
  context_length: number | null;
}

async function views(): Promise<Record<string, View>> {
  const res = await admin(api().get(VM_BASE)).expect(200);
  return Object.fromEntries((res.body as View[]).map((v) => [v.name, v]));
}

async function listedContext(): Promise<Record<string, number | undefined>> {
  const res = await api()
    .get('/v1/models')
    .set('Authorization', `Bearer ${TEST_OTLP_KEY}`)
    .expect(200);
  return Object.fromEntries(
    (res.body.data as Array<{ id: string; context_length?: number }>).map((m) => [
      m.id,
      m.context_length,
    ]),
  );
}

async function connect(provider: string): Promise<void> {
  await admin(api().post(`${ROUTING}/providers`))
    .send({ provider, apiKey: `sk-${provider}-e2e-test-key-000000` })
    .expect(201);
}

async function tenantProviderId(provider: string): Promise<string> {
  const rows: Array<{ id: string }> = await ds.query(
    `SELECT id FROM tenant_providers WHERE provider = $1 AND is_active = true`,
    [provider],
  );
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);

  jest
    .spyOn(app.get(ModelDiscoveryService), 'getModelsForAgent')
    .mockImplementation(async (_tenantId: string, agentId?: string) => {
      const rows: Array<{ provider: string }> = await ds.query(
        `SELECT tp.provider FROM tenant_providers tp
           JOIN agent_enabled_providers aep ON aep.tenant_provider_id = tp.id
          WHERE aep.agent_id = $1 AND tp.is_active = true`,
        [agentId],
      );
      const connected = new Set(rows.map((r) => r.provider));
      return MODELS.filter((m) => connected.has(m.provider) && !cold.has(m.provider));
    });

  await connect('openai');
  await connect('deepseek');

  // Default tier on OpenAI, so the agent keeps a routable provider throughout.
  await ds.query(
    `INSERT INTO tier_assignments (id, agent_id, tier, override_route, updated_at)
     VALUES ('vmd-default', $1, 'default', $2::jsonb, now())
     ON CONFLICT (agent_id, tier) DO UPDATE SET override_route = EXCLUDED.override_route`,
    [TEST_AGENT_ID, JSON.stringify({ provider: 'openai', authType: 'api_key', model: 'gpt-4o' })],
  );
  app.get(RoutingCacheService).invalidateAgent(TEST_AGENT_ID);

  await admin(api().post(VM_BASE))
    .send({ name: 'deepseek-only', override_route: { model: 'deepseek-chat' } })
    .expect(201);
  await admin(api().post(VM_BASE))
    .send({
      name: 'mixed',
      override_route: { model: 'deepseek-chat' },
      fallback_routes: [{ model: 'gpt-4o' }],
    })
    .expect(201);
}, 60000);

afterAll(async () => {
  jest.restoreAllMocks();
  await app.close();
});

describe('virtual models and a provider the agent no longer has', () => {
  it('counts every route while both providers are connected', async () => {
    expect(await views()).toMatchObject({
      'deepseek-only': { routable: true, context_length: 64000 },
      mixed: { routable: true, context_length: 64000 },
    });
    const listed = await listedContext();
    expect(listed['deepseek-only']).toBe(64000);
    expect(listed['mixed']).toBe(64000);
    const status = await routingStatus();
    expect(status).toMatchObject({ routes_by_virtual_model: true });
    expect(status['active_virtual_models']).toEqual(['deepseek-only', 'mixed']);
  });

  it('drops the routes of a provider disabled for the agent', async () => {
    const deepseekId = await tenantProviderId('deepseek');
    // The API refuses: virtual models still route to deepseek.
    await admin(api().delete(`/api/v1/agents/test-agent/enabled-providers/${deepseekId}`)).expect(
      409,
    );
    await ds.query(
      `DELETE FROM agent_enabled_providers WHERE agent_id = $1 AND tenant_provider_id = $2`,
      [TEST_AGENT_ID, deepseekId],
    );
    invalidateCaches();
    try {
      expect(await views()).toMatchObject({
        'deepseek-only': { routable: false, context_length: null },
        mixed: { routable: true, context_length: 128000 },
      });
      const listed = await listedContext();
      expect('deepseek-only' in listed).toBe(true);
      expect(listed['deepseek-only']).toBeUndefined();
      expect(listed['mixed']).toBe(128000);
      expect((await routingStatus())['active_virtual_models']).toEqual(['mixed']);
    } finally {
      await admin(api().put(`/api/v1/agents/test-agent/enabled-providers/${deepseekId}`)).expect(
        200,
      );
    }
    expect((await views())['deepseek-only'].routable).toBe(true);
  });

  it('keeps counting a connected provider with cold discovery, with an unknown window', async () => {
    cold.add('deepseek');
    try {
      expect(await views()).toMatchObject({
        'deepseek-only': { routable: true, context_length: null },
        mixed: { routable: true, context_length: null },
      });
      const listed = await listedContext();
      expect(listed['deepseek-only']).toBeUndefined();
      expect(listed['mixed']).toBeUndefined();
      expect((await routingStatus())['active_virtual_models']).toEqual(['deepseek-only', 'mixed']);
    } finally {
      cold.delete('deepseek');
    }
  });

  it('drops the routes of a disconnected provider', async () => {
    // The API refuses: virtual models still route to deepseek.
    await admin(api().delete(`${ROUTING}/providers/deepseek`)).expect(409);
    const deepseekId = await tenantProviderId('deepseek');
    await ds.query(`UPDATE tenant_providers SET is_active = false WHERE id = $1`, [deepseekId]);
    await ds.query(`DELETE FROM agent_enabled_providers WHERE tenant_provider_id = $1`, [
      deepseekId,
    ]);
    invalidateCaches();

    expect(await views()).toMatchObject({
      'deepseek-only': { routable: false, context_length: null },
      mixed: { routable: true, context_length: 128000 },
    });
    const listed = await listedContext();
    expect(listed['deepseek-only']).toBeUndefined();
    expect(listed['mixed']).toBe(128000);
    const status = await routingStatus();
    expect(status).toMatchObject({ routes_by_virtual_model: true });
    expect(status['active_virtual_models']).toEqual(['mixed']);
  });

  it('reports no virtual routing once every virtual route is disconnected', async () => {
    await admin(api().delete(`${VM_BASE}/${await vmId('mixed')}`)).expect(200);

    const status = await routingStatus();
    expect(status).toMatchObject({ routes_by_virtual_model: false, active_virtual_models: [] });
    expect((await views())['deepseek-only'].routable).toBe(false);
  });
});

function invalidateCaches(): void {
  const cache = app.get(RoutingCacheService);
  cache.invalidateAgent(TEST_AGENT_ID);
  cache.invalidateTenant(TEST_TENANT_ID);
}

async function vmId(name: string): Promise<string> {
  const res = await admin(api().get(VM_BASE)).expect(200);
  return (res.body as Array<{ id: string; name: string }>).find((v) => v.name === name)!.id;
}
