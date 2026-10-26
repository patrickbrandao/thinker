import { McpServer } from '@modelcontextprotocol/server';
import { McpOperator } from '../mcp-auth';
import { McpToolDeps } from '../tool-deps';
import { registerAgentTools } from './agents.tools';
import { registerEnvironmentTools, registerGuideTool } from './environment.tools';
import { registerIdentityTools } from './identity.tools';
import { registerModelTools } from './models.tools';
import { registerProviderTools } from './providers.tools';
import { registerRequestTools } from './requests.tools';
import { registerRoutingTools } from './routing.tools';

// The tool files read the server origin from the auth instance, which is
// ESM-only and cannot be required by Jest on Node 22. The origin is all they use.
jest.mock('../../auth/auth.instance', () => ({ authOrigin: 'http://localhost:2099' }));

type Handler = (args: Record<string, unknown>, ctx?: unknown) => Promise<unknown>;

function capture(): { server: McpServer; tools: Map<string, Handler> } {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

const TENANT = 'tenant-1';
const AGENT = { id: 'agent-1', tenant_id: TENANT, name: 'demo' };
const CONNECTION = {
  id: 'conn-1',
  provider: 'openai',
  auth_type: 'api_key',
  label: 'default',
  priority: 0,
  region: null,
  is_active: true,
  key_prefix: 'sk-',
  cached_models: [{ id: 'gpt-4o' }],
  models_fetched_at: '2026-01-01',
  connected_at: '2026-01-01',
  tenant_id: TENANT,
};

const VIRTUAL_ROW = {
  id: 'vm-1',
  agent_id: 'agent-1',
  tenant_id: TENANT,
  name: 'DeepSeek/Flash',
  sort_order: 0,
  enabled: true,
  override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
  fallback_routes: null,
  continue_on_default: true,
  response_mode: 'buffered',
  output_modality: 'text',
};
const VIRTUAL_VIEW = { ...VIRTUAL_ROW, shadows: [], context_length: 128000, routable: true };

function makeDeps(): McpToolDeps {
  const chainable = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  return {
    dataSource: {} as never,
    tenantCache: {} as never,
    agentListCache: { invalidate: jest.fn().mockResolvedValue(undefined) } as never,
    eventBus: { emit: jest.fn() } as never,
    recording: { isRecording: jest.fn().mockResolvedValue(true) } as never,
    timeseries: {
      getAgentList: jest.fn().mockResolvedValue([{ agent_name: 'demo', sparkline: [1, 2] }]),
    } as never,
    lifecycle: {
      findAgentInfo: jest.fn().mockResolvedValue({
        agent_name: 'demo',
        display_name: 'Demo',
        agent_category: 'coding',
        agent_platform: 'codex',
      }),
      renameAgent: jest.fn().mockResolvedValue(undefined),
      updateAgentType: jest.fn().mockResolvedValue(undefined),
      deleteAgent: jest.fn().mockResolvedValue(undefined),
    } as never,
    apiKeys: {
      onboardAgent: jest
        .fn()
        .mockResolvedValue({ tenantId: TENANT, agentId: 'agent-1', apiKey: 'k' }),
      getKeyForAgent: jest.fn().mockResolvedValue({ keyPrefix: 'p', fullKey: 'full' }),
      rotateKey: jest.fn().mockResolvedValue({ apiKey: 'r' }),
    } as never,
    messages: {
      getMessages: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'm' }], next_cursor: 'c', total_count: 1 }),
    } as never,
    providers: {
      getProviders: jest.fn().mockResolvedValue([CONNECTION]),
      enableAllProvidersForAgent: jest.fn().mockResolvedValue(undefined),
      upsertProvider: jest.fn().mockResolvedValue({ provider: CONNECTION, isNew: true }),
      removeProvider: jest.fn().mockResolvedValue({ notifications: ['n'] }),
      recalculateTiers: jest.fn().mockResolvedValue(undefined),
    } as never,
    tiers: {
      getTiers: jest.fn().mockResolvedValue([
        {
          tier: 'default',
          override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
          fallback_routes: [],
        },
      ]),
      hasRoutableTier: jest.fn().mockResolvedValue(true),
      getFallbacks: jest.fn().mockResolvedValue([]),
      setFallbacks: jest.fn().mockResolvedValue([]),
      clearFallbacks: jest.fn().mockResolvedValue(undefined),
      setOverride: jest.fn().mockResolvedValue({}),
    } as never,
    specificity: { getAssignments: jest.fn().mockResolvedValue([]) } as never,
    resolveAgent: {
      resolve: jest.fn().mockResolvedValue(AGENT),
      invalidate: jest.fn(),
    } as never,
    headerTiers: {
      list: jest.fn().mockResolvedValue([{ id: 'h1', name: 'tier' }]),
      create: jest.fn().mockResolvedValue({ id: 'h1', name: 'tier' }),
      setOverride: jest.fn().mockResolvedValue({}),
      setFallbacks: jest.fn().mockResolvedValue([]),
      clearFallbacks: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as never,
    virtualModels: {
      list: jest.fn().mockResolvedValue([VIRTUAL_ROW]),
      listViews: jest.fn().mockResolvedValue([VIRTUAL_VIEW]),
      create: jest.fn().mockResolvedValue(VIRTUAL_VIEW),
      update: jest.fn().mockResolvedValue(VIRTUAL_VIEW),
      setEnabled: jest.fn().mockResolvedValue(VIRTUAL_VIEW),
      setResponseMode: jest.fn().mockResolvedValue(VIRTUAL_VIEW),
      setOverride: jest.fn().mockResolvedValue(VIRTUAL_VIEW),
      clearOverride: jest.fn().mockResolvedValue(undefined),
      setFallbacks: jest.fn().mockResolvedValue([]),
      clearFallbacks: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as never,
    customProviders: {
      list: jest
        .fn()
        .mockResolvedValue([{ id: 'c1', name: 'cp', alias: 'cp', base_url: 'http://x' }]),
      create: jest.fn().mockResolvedValue({ id: 'c1', name: 'cp', alias: 'cp' }),
      remove: jest.fn().mockResolvedValue(undefined),
      probeModels: jest.fn().mockResolvedValue([{ model_name: 'm' }]),
    } as never,
    routeModelParams: {
      get: jest.fn().mockResolvedValue({ tier: 'default', params: [] }),
      update: jest.fn().mockResolvedValue({ tier: 'default', params: [] }),
    } as never,
    modelDiscovery: {
      getModelsForAgent: jest
        .fn()
        .mockResolvedValue([
          { id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o', authType: 'api_key' },
        ]),
      discoverModels: jest.fn().mockResolvedValue(undefined),
      refreshProvider: jest.fn().mockResolvedValue({ ok: true, model_count: 1 }),
      discoverAllForAgent: jest.fn().mockResolvedValue(undefined),
    } as never,
    pricingSync: {
      getAll: jest.fn().mockReturnValue(new Map([['gpt-4o', { input: 1, output: 2 }]])),
    } as never,
    modelPrices: {
      getAll: jest.fn().mockReturnValue({
        models: [
          {
            model_name: 'gpt-4o',
            provider: 'OpenAI',
            input_price_per_million: 1,
            output_price_per_million: 2,
            display_name: 'GPT-4o',
            validated: true,
          },
        ],
        lastSyncedAt: null,
      }),
    } as never,
    tenantProviderRepo: {} as never,
    agentEnabledProviderRepo: {
      createQueryBuilder: jest.fn().mockReturnValue(chainable),
      delete: jest.fn().mockResolvedValue(undefined),
    } as never,
    agentRepo: { update: jest.fn().mockResolvedValue(undefined) } as never,
  };
}

const OPERATOR: McpOperator = {
  userId: 'user-1',
  tenantId: TENANT,
  scopes: new Set(['mcp:read', 'mcp:write']),
};

function parse(res: unknown): { data?: unknown; error?: boolean; text: string } {
  const r = res as { content?: { text: string }[]; isError?: boolean };
  const text = r.content?.[0]?.text ?? '';
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { data, error: r.isError === true, text };
}

function registerAll(deps: McpToolDeps, operator = OPERATOR) {
  const { server, tools } = capture();
  registerIdentityTools(server, deps, operator);
  registerAgentTools(server, deps, operator);
  registerEnvironmentTools(server, deps, operator);
  registerProviderTools(server, deps, operator);
  registerRoutingTools(server, deps, operator);
  registerModelTools(server, deps, operator);
  registerRequestTools(server, deps, operator);
  registerGuideTool(server);
  return tools;
}

async function call(tools: Map<string, Handler>, name: string, args: Record<string, unknown> = {}) {
  const handler = tools.get(name);
  if (!handler) throw new Error(`no tool ${name}`);
  return parse(await handler(args));
}

describe('MCP tools', () => {
  describe('agent tools', () => {
    it('lists agents and strips the sparkline', async () => {
      const tools = registerAll(makeDeps());
      const { data } = await call(tools, 'thinker_agent_list', { include_playground: true });
      expect((data as { agents: Record<string, unknown>[] }).agents[0]).not.toHaveProperty(
        'sparkline',
      );
    });

    it('gets one agent', async () => {
      const { data } = await call(registerAll(makeDeps()), 'thinker_agent_get', { agent: 'demo' });
      expect(data).toMatchObject({ agent: { agent_name: 'demo' } });
    });

    it('lists platforms', async () => {
      const { data } = await call(registerAll(makeDeps()), 'thinker_agent_platforms');
      expect((data as { platforms: string[] }).platforms.length).toBeGreaterThan(0);
    });

    it('creates an agent and returns the key', async () => {
      const { data } = await call(registerAll(makeDeps()), 'thinker_agent_create', {
        name: 'My Agent',
        agent_platform: 'codex',
        agent_category: 'automation',
        record_messages: false,
      });
      expect(data).toMatchObject({ agent: { name: 'my-agent' }, apiKey: 'k' });
    });

    it('rejects a reserved name and an empty slug', async () => {
      const tools = registerAll(makeDeps());
      expect((await call(tools, 'thinker_agent_create', { name: 'Playground' })).error).toBe(true);
      expect((await call(tools, 'thinker_agent_create', { name: '!!!' })).error).toBe(true);
    });

    it('rolls back the agent when provider enablement fails, and survives a failed rollback', async () => {
      const deps = makeDeps();
      (deps.providers.enableAllProvidersForAgent as jest.Mock).mockRejectedValueOnce(
        new Error('boom'),
      );
      const first = await call(registerAll(deps), 'thinker_agent_create', { name: 'A' });
      expect(first.error).toBe(true);

      const deps2 = makeDeps();
      (deps2.providers.enableAllProvidersForAgent as jest.Mock).mockRejectedValueOnce(
        new Error('boom'),
      );
      (deps2.lifecycle.deleteAgent as jest.Mock).mockRejectedValueOnce(new Error('cleanup'));
      expect((await call(registerAll(deps2), 'thinker_agent_create', { name: 'B' })).error).toBe(
        true,
      );
    });

    it('renames / retypes and rejects the reserved slug', async () => {
      const tools = registerAll(makeDeps());
      const ok = await call(tools, 'thinker_agent_update', {
        agent: 'demo',
        name: 'Renamed',
        agent_category: 'coding',
        agent_platform: 'openai-sdk',
      });
      expect(ok.error).toBeFalsy();
      expect(
        (await call(tools, 'thinker_agent_update', { agent: 'demo', name: 'Playground' })).error,
      ).toBe(true);
    });

    it('deletes, rotates, and shows a key', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      expect((await call(tools, 'thinker_agent_delete', { agent: 'demo' })).error).toBeFalsy();
      expect((await call(tools, 'thinker_agent_rotate_key', { agent: 'demo' })).error).toBeFalsy();
      const show = await call(tools, 'thinker_agent_key_show', { agent: 'demo' });
      expect(show.data).toMatchObject({ apiKey: 'full' });
      (deps.lifecycle.findAgentInfo as jest.Mock).mockResolvedValueOnce(null);
      expect((await call(tools, 'thinker_agent_key_show', { agent: 'x' })).error).toBe(true);
      (deps.lifecycle.findAgentInfo as jest.Mock).mockResolvedValueOnce(null);
      expect((await call(tools, 'thinker_agent_rotate_key', { agent: 'x' })).error).toBe(true);
    });

    it('hides write tools from a read-only token', () => {
      const tools = registerAll(makeDeps(), { ...OPERATOR, scopes: new Set(['mcp:read']) });
      expect(tools.has('thinker_agent_list')).toBe(true);
      expect(tools.has('thinker_agent_create')).toBe(false);
    });
  });

  describe('provider tools', () => {
    it('lists connections and custom providers', async () => {
      const { data } = await call(registerAll(makeDeps()), 'thinker_provider_list');
      expect(data).toMatchObject({ connections: [{ cached_model_count: 1 }] });
    });

    it('counts a custom connection by the models entered on its custom provider', async () => {
      const deps = makeDeps();
      (deps.providers.getProviders as jest.Mock).mockResolvedValue([
        CONNECTION,
        { ...CONNECTION, id: 'conn-2', provider: 'custom:c1', cached_models: null },
      ]);
      (deps.customProviders.list as jest.Mock).mockResolvedValue([
        {
          id: 'c1',
          name: 'cp',
          alias: 'cp',
          base_url: 'http://x',
          models: [{ model_name: 'a' }, { model_name: 'b' }],
        },
        { id: 'c2', name: 'empty', alias: 'empty', base_url: 'http://y', models: null },
      ]);
      const tools = registerAll(deps);

      const { data } = await call(tools, 'thinker_provider_list');
      expect(data).toMatchObject({
        connections: [{ cached_model_count: 1 }, { cached_model_count: 2 }],
        custom_providers: [{ model_count: 2 }, { model_count: 0 }],
      });

      const refreshed = await call(tools, 'thinker_provider_refresh', { agent: 'demo' });
      expect(refreshed.data).toMatchObject({
        connections: [{ cached_model_count: 1 }, { cached_model_count: 2 }],
      });
    });

    it('counts a connection with no discovery cache as empty', async () => {
      const deps = makeDeps();
      (deps.providers.getProviders as jest.Mock).mockResolvedValue([
        { ...CONNECTION, cached_models: null },
      ]);
      const { data } = await call(registerAll(deps), 'thinker_provider_list');
      expect(data).toMatchObject({ connections: [{ cached_model_count: 0 }] });
    });

    it('returns the catalog', async () => {
      const { data } = await call(registerAll(makeDeps()), 'thinker_provider_catalog');
      expect((data as { providers: unknown[] }).providers.length).toBeGreaterThan(0);
    });

    it('connects a known provider and rejects an unknown one', async () => {
      const tools = registerAll(makeDeps());
      expect(
        (await call(tools, 'thinker_provider_connect', { provider: 'openai', agent: 'demo' }))
          .error,
      ).toBeFalsy();
      expect(
        (await call(tools, 'thinker_provider_connect', { provider: 'nope', agent: 'demo' })).error,
      ).toBe(true);
      // Built-in local providers connect with no deployment mode configured.
      expect(
        (await call(tools, 'thinker_provider_connect', { provider: 'ollama', agent: 'demo' }))
          .error,
      ).toBeFalsy();

      // Discovery failing after the connection is saved still succeeds.
      const discoveryFails = makeDeps();
      (discoveryFails.modelDiscovery.discoverModels as jest.Mock).mockRejectedValueOnce(
        new Error('upstream down'),
      );
      const res = await call(registerAll(discoveryFails), 'thinker_provider_connect', {
        provider: 'openai',
        agent: 'demo',
      });
      expect(res.error).toBeFalsy();
      expect(res.data).toMatchObject({
        models_discovered: false,
        discovery_error: 'upstream down',
      });
    });

    it('disconnects and refreshes', async () => {
      const tools = registerAll(makeDeps());
      expect(
        (await call(tools, 'thinker_provider_disconnect', { provider: 'openai', agent: 'demo' }))
          .error,
      ).toBeFalsy();
      expect(
        (await call(tools, 'thinker_provider_refresh', { agent: 'demo', provider: 'openai' }))
          .error,
      ).toBeFalsy();
      expect((await call(tools, 'thinker_provider_refresh', { agent: 'demo' })).error).toBeFalsy();
    });

    it('adds and removes a custom provider', async () => {
      const tools = registerAll(makeDeps());
      const add = await call(tools, 'thinker_provider_custom_add', {
        name: 'cp',
        base_url: 'http://127.0.0.1:1/v1',
        alias: 'cp',
      });
      expect(add.error).toBeFalsy();
      expect((await call(tools, 'thinker_provider_custom_list')).error).toBeFalsy();
      expect(
        (await call(tools, 'thinker_provider_custom_remove', { name: 'cp' })).error,
      ).toBeFalsy();

      // An endpoint with no models and no explicit list is an error.
      const deps = makeDeps();
      (deps.customProviders.probeModels as jest.Mock).mockResolvedValueOnce([]);
      expect(
        (
          await call(registerAll(deps), 'thinker_provider_custom_add', {
            name: 'empty',
            base_url: 'http://127.0.0.1:1/v1',
          })
        ).error,
      ).toBe(true);
    });

    it('enables and disables a provider for an agent (route impact blocks disable)', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      expect(
        (await call(tools, 'thinker_agent_provider_enable', { agent: 'demo', provider: 'openai' }))
          .error,
      ).toBeFalsy();
      // The default tier points at openai, so disable must be rejected.
      const blocked = await call(tools, 'thinker_agent_provider_disable', {
        agent: 'demo',
        provider: 'openai',
      });
      expect(blocked.error).toBe(true);

      (deps.tiers.getTiers as jest.Mock).mockResolvedValueOnce([
        { tier: 'default', override_route: null, fallback_routes: [] },
      ]);
      expect(
        (
          await call(tools, 'thinker_agent_provider_disable', {
            agent: 'demo',
            provider: 'openai',
          })
        ).error,
      ).toBeFalsy();

      // No matching connection.
      expect(
        (
          await call(tools, 'thinker_agent_provider_enable', {
            agent: 'demo',
            provider: 'anthropic',
          })
        ).error,
      ).toBe(true);
    });

    it('covers the specificity branch of the route-impact scan', async () => {
      const deps = makeDeps();
      (deps.tiers.getTiers as jest.Mock).mockResolvedValue([
        { tier: 'default', override_route: null, fallback_routes: [] },
      ]);
      (deps.specificity.getAssignments as jest.Mock).mockResolvedValue([
        {
          category: 'coding',
          override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
          fallback_routes: [],
        },
      ]);
      const blocked = await call(registerAll(deps), 'thinker_agent_provider_disable', {
        agent: 'demo',
        provider: 'openai',
      });
      expect(blocked.error).toBe(true);
    });

    it('scans tier, header-tier, and specificity fallbacks for the disabled provider', async () => {
      const deps = makeDeps();
      (deps.providers.getProviders as jest.Mock).mockResolvedValue([
        { ...CONNECTION, priority: 1, label: 'work' },
      ]);
      const matching = {
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o',
        keyLabel: 'work',
      };
      (deps.tiers.getTiers as jest.Mock).mockResolvedValue([
        // No keyLabel, priority!=0, label!='default' → not affected.
        {
          tier: 'default',
          override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
          fallback_routes: [],
        },
        { tier: 'team', override_route: null, fallback_routes: [matching] },
      ]);
      (deps.headerTiers.list as jest.Mock).mockResolvedValue([
        { id: 'h1', name: 'hdr', override_route: null, fallback_routes: [matching] },
      ]);
      (deps.specificity.getAssignments as jest.Mock).mockResolvedValue([
        // No provider field → matched by model id.
        { category: 'coding', override_route: null, fallback_routes: [{ model: 'gpt-4o' }] },
      ]);
      const blocked = await call(registerAll(deps), 'thinker_agent_provider_disable', {
        agent: 'demo',
        provider: 'openai',
      });
      expect(blocked.error).toBe(true);
    });
  });

  describe('routing tools', () => {
    it('reports status in each branch', async () => {
      // These are the auto-route verdicts; virtual models are covered below.
      const depsWithoutVirtualModels = () => {
        const d = makeDeps();
        (d.virtualModels.listViews as jest.Mock).mockResolvedValue([]);
        return d;
      };
      const deps = depsWithoutVirtualModels();
      expect(
        (await call(registerAll(deps), 'thinker_routing_status', { agent: 'demo' })).data,
      ).toMatchObject({ enabled: true });

      const noProviders = depsWithoutVirtualModels();
      (noProviders.providers.getProviders as jest.Mock).mockResolvedValue([]);
      expect(
        (await call(registerAll(noProviders), 'thinker_routing_status', { agent: 'demo' })).data,
      ).toMatchObject({ reason: 'no_provider' });

      const inactiveOnly = depsWithoutVirtualModels();
      (inactiveOnly.providers.getProviders as jest.Mock).mockResolvedValue([
        { ...CONNECTION, is_active: false },
      ]);
      expect(
        (await call(registerAll(inactiveOnly), 'thinker_routing_status', { agent: 'demo' })).data,
      ).toMatchObject({ reason: 'no_provider' });

      // #75: an empty pricing cache (right after boot, or a failed fetch) does
      // not block an agent that can route, same as the REST endpoint.
      const noPricing = depsWithoutVirtualModels();
      (noPricing.pricingSync.getAll as jest.Mock).mockReturnValue(new Map());
      expect(
        (await call(registerAll(noPricing), 'thinker_routing_status', { agent: 'demo' })).data,
      ).toMatchObject({ enabled: true, reason: null });

      // It only explains an agent that cannot route.
      const noPricingNotRoutable = depsWithoutVirtualModels();
      (noPricingNotRoutable.pricingSync.getAll as jest.Mock).mockReturnValue(new Map());
      (noPricingNotRoutable.tiers.hasRoutableTier as jest.Mock).mockResolvedValue(false);
      expect(
        (
          await call(registerAll(noPricingNotRoutable), 'thinker_routing_status', {
            agent: 'demo',
          })
        ).data,
      ).toMatchObject({ enabled: false, reason: 'pricing_cache_empty' });

      // With THINKER_CATALOG_SYNC=false the cache is empty by design, so it is
      // not blamed.
      const previous = process.env['THINKER_CATALOG_SYNC'];
      process.env['THINKER_CATALOG_SYNC'] = 'false';
      try {
        expect(
          (
            await call(registerAll(noPricingNotRoutable), 'thinker_routing_status', {
              agent: 'demo',
            })
          ).data,
        ).toMatchObject({ enabled: false, reason: 'no_routable_models' });
      } finally {
        if (previous === undefined) delete process.env['THINKER_CATALOG_SYNC'];
        else process.env['THINKER_CATALOG_SYNC'] = previous;
      }

      const notRoutable = depsWithoutVirtualModels();
      (notRoutable.tiers.hasRoutableTier as jest.Mock).mockResolvedValue(false);
      expect(
        (await call(registerAll(notRoutable), 'thinker_routing_status', { agent: 'demo' })).data,
      ).toMatchObject({ reason: 'no_routable_models' });
    });

    it('reads and writes fallbacks', async () => {
      const tools = registerAll(makeDeps());
      expect(
        (await call(tools, 'thinker_routing_fallbacks_get', { agent: 'demo' })).error,
      ).toBeFalsy();
      expect(
        (await call(tools, 'thinker_routing_fallbacks_set', { agent: 'demo', models: ['a', 'b'] }))
          .error,
      ).toBeFalsy();
      expect(
        (await call(tools, 'thinker_routing_fallbacks_clear', { agent: 'demo' })).error,
      ).toBeFalsy();
    });

    it('reads and writes model params by tier and model', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      const got = await call(tools, 'thinker_routing_params_get', {
        agent: 'demo',
        tier: 'deep',
        model: 'gpt-5',
      });
      expect(got.data).toEqual({ tier: 'default', params: [] });
      expect(deps.routeModelParams.get).toHaveBeenCalledWith('agent-1', 'deep', 'gpt-5', TENANT);

      const set = await call(tools, 'thinker_routing_params_set', {
        agent: 'demo',
        tier: 'deep',
        model: 'gpt-5',
        set: { 'reasoning.effort': 'high' },
        unset: ['temperature'],
      });
      expect(set.error).toBe(false);
      expect(deps.routeModelParams.update).toHaveBeenCalledWith(
        'agent-1',
        'deep',
        'gpt-5',
        { set: { 'reasoning.effort': 'high' }, unset: ['temperature'] },
        TENANT,
      );
    });

    it('addresses model params by virtual model, exclusive with tier', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      const got = await call(tools, 'thinker_routing_params_get', {
        agent: 'demo',
        virtual: 'deepseek/flash',
      });
      expect(got.error).toBe(false);
      expect(deps.routeModelParams.get).toHaveBeenCalledWith(
        'agent-1',
        { virtual: 'deepseek/flash' },
        undefined,
        TENANT,
      );

      await call(tools, 'thinker_routing_params_set', {
        agent: 'demo',
        virtual: 'deepseek/flash',
        model: 'gpt-4o',
        set: { temperature: 0.2 },
      });
      expect(deps.routeModelParams.update).toHaveBeenCalledWith(
        'agent-1',
        { virtual: 'deepseek/flash' },
        'gpt-4o',
        { set: { temperature: 0.2 }, unset: undefined },
        TENANT,
      );

      const both = await call(tools, 'thinker_routing_params_get', {
        agent: 'demo',
        tier: 'default',
        virtual: 'deepseek/flash',
      });
      expect(both.error).toBe(true);
      expect(both.text).toBe('Pass tier or virtual, not both');
      const bothSet = await call(tools, 'thinker_routing_params_set', {
        agent: 'demo',
        tier: 'default',
        virtual: 'x',
        set: { temperature: 1 },
      });
      expect(bothSet.error).toBe(true);
      expect(deps.routeModelParams.update).toHaveBeenCalledTimes(1);
    });

    it('hides the params write tool from a read-only token', () => {
      const tools = registerAll(makeDeps(), { ...OPERATOR, scopes: new Set(['mcp:read']) });
      expect(tools.has('thinker_routing_params_get')).toBe(true);
      expect(tools.has('thinker_routing_params_set')).toBe(false);
    });

    it('lists the virtual models in the routing status', async () => {
      const { data } = await call(registerAll(makeDeps()), 'thinker_routing_status', {
        agent: 'demo',
      });
      expect(data).toEqual({
        status_for: 'auto',
        enabled: true,
        reason: null,
        routes_by_virtual_model: true,
        active_virtual_models: ['DeepSeek/Flash'],
        virtual_models: [
          {
            id: 'vm-1',
            name: 'DeepSeek/Flash',
            enabled: true,
            route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
            fallbacks: [],
            continue_on_default: true,
            response_mode: 'buffered',
          },
        ],
      });
    });

    it('says when only virtual models route, without blaming the auto route reason', async () => {
      // auto cannot route, but an enabled virtual model with a primary can.
      const deps = makeDeps();
      (deps.tiers.hasRoutableTier as jest.Mock).mockResolvedValue(false);
      const onlyVirtual = await call(registerAll(deps), 'thinker_routing_status', {
        agent: 'demo',
      });
      expect(onlyVirtual.data).toMatchObject({
        status_for: 'auto',
        enabled: false,
        reason: 'auto_not_routable',
        auto_reason: 'no_routable_models',
        routes_by_virtual_model: true,
        active_virtual_models: ['DeepSeek/Flash'],
      });

      // The service decides `routable` on the proxy's chain (only the
      // `default` slot is appended); the tool trusts it, whatever other tiers
      // hasRoutableTier saw.
      (deps.virtualModels.listViews as jest.Mock).mockResolvedValue([
        { ...VIRTUAL_VIEW, routable: false },
        { ...VIRTUAL_VIEW, id: 'vm-3', name: 'onDefault', routable: false },
      ]);
      const none = await call(registerAll(deps), 'thinker_routing_status', { agent: 'demo' });
      expect(none.data).toMatchObject({
        enabled: false,
        reason: 'no_routable_models',
        routes_by_virtual_model: false,
        active_virtual_models: [],
      });
      (deps.tiers.hasRoutableTier as jest.Mock).mockResolvedValue(true);
      const otherTierRoutes = await call(registerAll(deps), 'thinker_routing_status', {
        agent: 'demo',
      });
      expect(otherTierRoutes.data).toMatchObject({
        enabled: true,
        routes_by_virtual_model: false,
        active_virtual_models: [],
      });

      // With no active provider nothing routes, virtual models included.
      const noProvider = makeDeps();
      (noProvider.providers.getProviders as jest.Mock).mockResolvedValue([]);
      expect(
        (await call(registerAll(noProvider), 'thinker_routing_status', { agent: 'demo' })).data,
      ).toMatchObject({ reason: 'no_provider', routes_by_virtual_model: false });
    });

    it('lists virtual models with their computed fields', async () => {
      const deps = makeDeps();
      const { data } = await call(registerAll(deps), 'thinker_routing_virtual_list', {
        agent: 'demo',
      });
      expect(data).toEqual({ virtual_models: [VIRTUAL_VIEW] });
      expect(deps.virtualModels.listViews).toHaveBeenCalledWith('agent-1', TENANT);
    });

    it('creates a virtual model with its chain in one service call', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      const res = await call(tools, 'thinker_routing_virtual_create', {
        agent: 'demo',
        name: 'deepseek',
        model: 'deepseek-chat',
        provider: 'deepseek',
        auth_type: 'api_key',
        key_label: 'Work',
        fallbacks: ['gpt-4o'],
        continue_on_default: true,
        response_mode: 'stream',
      });
      expect(res.data).toEqual({ virtual_model: VIRTUAL_VIEW });
      expect(deps.virtualModels.create).toHaveBeenCalledWith('agent-1', TENANT, {
        name: 'deepseek',
        override_route: {
          model: 'deepseek-chat',
          provider: 'deepseek',
          authType: 'api_key',
          keyLabel: 'Work',
        },
        fallback_routes: [{ model: 'gpt-4o' }],
        continue_on_default: true,
        response_mode: 'stream',
      });

      // A name-only virtual model (pure "continue on Default") is valid.
      await call(tools, 'thinker_routing_virtual_create', { agent: 'demo', name: 'alias' });
      expect(deps.virtualModels.create).toHaveBeenLastCalledWith('agent-1', TENANT, {
        name: 'alias',
        override_route: null,
        fallback_routes: [],
      });
    });

    it('rejects fallbacks or route pins without a primary, and surfaces service errors', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      const noPrimary = await call(tools, 'thinker_routing_virtual_create', {
        agent: 'demo',
        name: 'x',
        fallbacks: ['gpt-4o'],
      });
      expect(noPrimary.error).toBe(true);
      expect(noPrimary.text).toContain('fallbacks require a model');
      const pinOnly = await call(tools, 'thinker_routing_virtual_create', {
        agent: 'demo',
        name: 'x',
        provider: 'openai',
      });
      expect(pinOnly.text).toContain('need a model');
      expect(deps.virtualModels.create).not.toHaveBeenCalled();

      (deps.virtualModels.create as jest.Mock).mockRejectedValueOnce(
        new Error('A virtual model named "x" already exists on this agent'),
      );
      const dup = await call(tools, 'thinker_routing_virtual_create', { agent: 'demo', name: 'x' });
      expect(dup.error).toBe(true);
      expect(dup.text).toContain('already exists');
    });

    it('updates a virtual model found by name, routes first', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      const order: string[] = [];
      for (const method of [
        'setOverride',
        'setFallbacks',
        'setResponseMode',
        'update',
        'setEnabled',
      ] as const) {
        (deps.virtualModels[method] as jest.Mock).mockImplementation(async () => {
          order.push(method);
          return VIRTUAL_VIEW;
        });
      }
      const res = await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'deepseek/FLASH',
        name: 'flash',
        model: 'gpt-4o-mini',
        fallbacks: ['gpt-4o'],
        continue_on_default: false,
        response_mode: 'stream',
        enabled: false,
      });
      expect(res.data).toEqual({ virtual_model: VIRTUAL_VIEW });
      expect(order).toEqual([
        'setOverride',
        'setFallbacks',
        'setResponseMode',
        'update',
        'setEnabled',
      ]);
      expect(deps.virtualModels.setOverride).toHaveBeenCalledWith('agent-1', TENANT, 'vm-1', {
        model: 'gpt-4o-mini',
      });
      expect(deps.virtualModels.setFallbacks).toHaveBeenCalledWith('agent-1', TENANT, 'vm-1', [
        'gpt-4o',
      ]);
      expect(deps.virtualModels.update).toHaveBeenCalledWith('agent-1', TENANT, 'vm-1', {
        name: 'flash',
        continue_on_default: false,
      });
      expect(deps.virtualModels.setEnabled).toHaveBeenCalledWith('agent-1', TENANT, 'vm-1', false);
    });

    it('refuses a taken or invalid name before writing, and reports a partial update', async () => {
      const deps = makeDeps();
      (deps.virtualModels.list as jest.Mock).mockResolvedValue([
        VIRTUAL_ROW,
        { ...VIRTUAL_ROW, id: 'vm-2', name: 'Other' },
      ]);
      const tools = registerAll(deps);
      const taken = await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        model: 'gpt-4o-mini',
        name: 'other',
      });
      expect(taken.text).toBe('A virtual model named "other" already exists on this agent');
      const invalid = await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        model: 'gpt-4o-mini',
        name: 'auto',
      });
      expect(invalid.error).toBe(true);
      expect(deps.virtualModels.setOverride).not.toHaveBeenCalled();

      (deps.virtualModels.setFallbacks as jest.Mock).mockRejectedValueOnce(
        new Error('Fallback "nope" is not available'),
      );
      const partial = await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        model: 'gpt-4o-mini',
        fallbacks: ['nope'],
        enabled: false,
      });
      expect(partial.text).toBe(
        'Fallback "nope" is not available (already applied to "DeepSeek/Flash": model)',
      );
      expect(deps.virtualModels.setEnabled).not.toHaveBeenCalled();

      // A failure on the first write needs no suffix.
      (deps.virtualModels.setOverride as jest.Mock).mockRejectedValueOnce(new Error('bad model'));
      const first = await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        model: 'x',
      });
      expect(first.text).toBe('bad model');
    });

    it('clears fallbacks with [], the primary with clear_model, and finds by id', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        fallbacks: [],
      });
      expect(deps.virtualModels.clearFallbacks).toHaveBeenCalledWith('agent-1', 'vm-1');
      expect(deps.virtualModels.update).not.toHaveBeenCalled();

      await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        clear_model: true,
        fallbacks: [],
      });
      expect(deps.virtualModels.clearOverride).toHaveBeenCalledWith('agent-1', 'vm-1');
      expect(deps.virtualModels.clearFallbacks).toHaveBeenCalledTimes(1);
    });

    it('rejects an empty, contradictory or unknown update', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      const nothing = await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'deepseek/flash',
      });
      expect(nothing.text).toBe('Nothing to change');
      const clash = await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'deepseek/flash',
        clear_model: true,
        model: 'gpt-4o',
      });
      expect(clash.text).toContain('clear_model cannot be combined');
      const unknown = await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'ghost',
        enabled: true,
      });
      expect(unknown.error).toBe(true);
      expect(unknown.text).toBe(
        'Virtual model "ghost" not found for "demo" (virtual models: DeepSeek/Flash)',
      );

      (deps.virtualModels.list as jest.Mock).mockResolvedValue([
        { ...VIRTUAL_ROW, override_route: null },
      ]);
      const orphan = await call(tools, 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'deepseek/flash',
        fallbacks: ['gpt-4o'],
      });
      expect(orphan.text).toContain('fallbacks require a model');
      expect(deps.virtualModels.setFallbacks).not.toHaveBeenCalled();
    });

    it('deletes a virtual model by name, and reports an unknown one', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      const res = await call(tools, 'thinker_routing_virtual_delete', {
        agent: 'demo',
        virtual: 'DEEPSEEK/flash',
      });
      expect(res.data).toEqual({ ok: true, deleted: { id: 'vm-1', name: 'DeepSeek/Flash' } });
      expect(deps.virtualModels.delete).toHaveBeenCalledWith('agent-1', 'vm-1');

      (deps.virtualModels.list as jest.Mock).mockResolvedValue([]);
      const none = await call(tools, 'thinker_routing_virtual_delete', {
        agent: 'demo',
        virtual: 'x',
      });
      expect(none.text).toBe('Virtual model "x" not found for "demo" (it has no virtual models)');
    });

    it('keeps the virtual model write tools from a read-only token', () => {
      const tools = registerAll(makeDeps(), { ...OPERATOR, scopes: new Set(['mcp:read']) });
      expect(tools.has('thinker_routing_virtual_list')).toBe(true);
      for (const name of [
        'thinker_routing_virtual_create',
        'thinker_routing_virtual_update',
        'thinker_routing_virtual_delete',
      ]) {
        expect(tools.has(name)).toBe(false);
      }
    });

    it('reads and writes recording, and exposes no repair toggle', async () => {
      const tools = registerAll(makeDeps());
      expect([...tools.keys()].filter((name) => name.includes('auto'))).toEqual([]);
      expect(
        (await call(tools, 'thinker_routing_recording_get', { agent: 'demo' })).error,
      ).toBeFalsy();
      expect(
        (await call(tools, 'thinker_routing_recording_set', { agent: 'demo', enabled: true }))
          .error,
      ).toBeFalsy();
    });

    it('manages custom tiers, including rollback', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      expect(
        (await call(tools, 'thinker_routing_custom_list', { agent: 'demo' })).error,
      ).toBeFalsy();
      expect(
        (
          await call(tools, 'thinker_routing_custom_create', {
            agent: 'demo',
            name: 'tier',
            header_key: 'x',
            header_value: 'y',
            badge_color: 'indigo',
            model: 'gpt-4o',
            provider: 'openai',
            fallbacks: ['gpt-4o'],
          })
        ).error,
      ).toBeFalsy();
      expect(
        (await call(tools, 'thinker_routing_custom_delete', { agent: 'demo', id: 'h1' })).error,
      ).toBeFalsy();

      (deps.headerTiers.setOverride as jest.Mock).mockRejectedValueOnce(new Error('nope'));
      expect(
        (
          await call(tools, 'thinker_routing_custom_create', {
            agent: 'demo',
            name: 'tier2',
            header_key: 'x',
            header_value: 'y',
            badge_color: 'indigo',
            model: 'gpt-4o',
            provider: 'openai',
          })
        ).error,
      ).toBe(true);

      // Fallbacks without a primary route are rejected.
      expect(
        (
          await call(tools, 'thinker_routing_custom_create', {
            agent: 'demo',
            name: 'tier3',
            header_key: 'x',
            header_value: 'y',
            badge_color: 'indigo',
            fallbacks: ['gpt-4o'],
          })
        ).error,
      ).toBe(true);
    });

    it('configures the default route, a custom tier, and toggles', async () => {
      const deps = makeDeps();
      const tools = registerAll(deps);
      expect(
        (
          await call(tools, 'thinker_agent_configure', {
            agent: 'demo',
            models: ['gpt-4o'],
            provider: 'openai',
          })
        ).error,
      ).toBeFalsy();
      expect(
        (
          await call(tools, 'thinker_agent_configure', {
            agent: 'demo',
            models: ['gpt-4o', 'gpt-4o'],
            provider: 'openai',
            tier: 'test',
            auth_type: 'api_key',
            key_label: 'default',
          })
        ).error,
      ).toBeFalsy();
      // Default tier with a fallback (set branch) and a custom tier with none.
      expect(
        (
          await call(tools, 'thinker_agent_configure', {
            agent: 'demo',
            models: ['gpt-4o', 'gpt-4o'],
            provider: 'openai',
          })
        ).error,
      ).toBeFalsy();
      expect(
        (
          await call(tools, 'thinker_agent_configure', {
            agent: 'demo',
            models: ['gpt-4o'],
            provider: 'openai',
            tier: 'test',
          })
        ).error,
      ).toBeFalsy();
      expect(
        (
          await call(tools, 'thinker_agent_configure', {
            agent: 'demo',
            recording: true,
          })
        ).error,
      ).toBeFalsy();

      // Nothing to configure.
      expect((await call(tools, 'thinker_agent_configure', { agent: 'demo' })).error).toBe(true);
      // tier without a route.
      expect(
        (await call(tools, 'thinker_agent_configure', { agent: 'demo', tier: 'x' })).error,
      ).toBe(true);
      // Unknown model without force.
      expect(
        (
          await call(tools, 'thinker_agent_configure', {
            agent: 'demo',
            models: ['nope'],
            provider: 'openai',
          })
        ).error,
      ).toBe(true);
      // force skips the check.
      expect(
        (
          await call(tools, 'thinker_agent_configure', {
            agent: 'demo',
            models: ['nope'],
            provider: 'openai',
            force: true,
          })
        ).error,
      ).toBeFalsy();
      // Missing provider.
      expect(
        (await call(tools, 'thinker_agent_configure', { agent: 'demo', models: ['gpt-4o'] })).error,
      ).toBe(true);
    });

    it('checks the primary against its provider and takes its auth type from discovery', async () => {
      const deps = makeDeps();
      (deps.modelDiscovery.getModelsForAgent as jest.Mock).mockResolvedValue([
        { id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o', authType: 'api_key' },
        { id: 'gpt-5.4', provider: 'openai', displayName: 'GPT-5.4', authType: 'subscription' },
      ]);
      const tools = registerAll(deps);

      // A model another provider offers no longer passes the guard.
      const wrong = await call(tools, 'thinker_agent_configure', {
        agent: 'demo',
        models: ['gpt-4o'],
        provider: 'anthropic',
      });
      expect(wrong.error).toBe(true);
      expect(wrong.text).toContain('not offered by provider "anthropic"');

      // An unknown fallback is still named.
      const fallback = await call(tools, 'thinker_agent_configure', {
        agent: 'demo',
        models: ['gpt-4o', 'nope'],
        provider: 'openai',
      });
      expect(fallback.error).toBe(true);
      expect(fallback.text).toContain('Not in the models discovered for "demo": nope');

      // No auth_type: a subscription model stays a subscription route.
      await call(tools, 'thinker_agent_configure', {
        agent: 'demo',
        models: ['openai/gpt-5.4-subscription'],
        provider: 'openai',
      });
      expect(deps.tiers.setOverride).toHaveBeenLastCalledWith(
        'agent-1',
        expect.anything(),
        'default',
        'openai/gpt-5.4-subscription',
        'openai',
        'subscription',
        undefined,
      );
    });

    it('rejects tier-only config and rolls back a failed new custom tier', async () => {
      const tools = registerAll(makeDeps());
      // tier with another toggle set reaches the "tier needs models" guard.
      expect(
        (
          await call(tools, 'thinker_agent_configure', {
            agent: 'demo',
            tier: 'x',
            recording: true,
          })
        ).error,
      ).toBe(true);

      const deps = makeDeps();
      (deps.headerTiers.list as jest.Mock).mockResolvedValueOnce([]);
      (deps.headerTiers.setOverride as jest.Mock).mockRejectedValueOnce(new Error('boom'));
      const res = await call(registerAll(deps), 'thinker_agent_configure', {
        agent: 'demo',
        models: ['gpt-4o'],
        provider: 'openai',
        tier: 'new',
      });
      expect(res.error).toBe(true);
      expect(deps.headerTiers.delete).toHaveBeenCalledWith('agent-1', 'h1');
    });

    it('runs an end-to-end route test across surfaces', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'gpt-4o',
            choices: [{ message: { content: 'OK' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      try {
        const tools = registerAll(makeDeps());
        const res = await call(tools, 'thinker_routing_test', {
          agent: 'demo',
          prompt: 'hi',
          as: 'openclaw',
        });
        expect(res.data).toMatchObject({ ok: true, reply: 'OK', surface: 'chat_completions' });

        // messages surface
        global.fetch = jest.fn().mockResolvedValue(
          new Response(JSON.stringify({ model: 'm', content: [{ type: 'text', text: 'HI' }] }), {
            status: 200,
          }),
        );
        expect(
          (await call(tools, 'thinker_routing_test', { agent: 'demo', as: 'claude-code' })).data,
        ).toMatchObject({ surface: 'messages', reply: 'HI' });

        // unknown platform
        expect(
          (await call(tools, 'thinker_routing_test', { agent: 'demo', as: 'constructor' })).error,
        ).toBe(true);

        // upstream failure
        global.fetch = jest
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 }),
          );
        expect(
          (await call(tools, 'thinker_routing_test', { agent: 'demo', as: 'openclaw' })).error,
        ).toBe(true);

        // 2xx with no payload
        global.fetch = jest
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
        expect(
          (await call(tools, 'thinker_routing_test', { agent: 'demo', as: 'openclaw' })).error,
        ).toBe(true);

        // Thinker error reply
        global.fetch = jest.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '[🦚 Thinker M100] no provider' } }],
            }),
            { status: 200 },
          ),
        );
        expect(
          (await call(tools, 'thinker_routing_test', { agent: 'demo', as: 'openclaw' })).error,
        ).toBe(true);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('reports the virtual model and the routing reason a test went through', async () => {
      const originalFetch = global.fetch;
      const fetchMock = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ model: 'gpt-4o', choices: [{ message: { content: 'OK' } }] }),
          {
            status: 200,
            headers: {
              'X-Thinker-Reason': 'virtual-model',
              'X-Thinker-Virtual-Model': 'DeepSeek/Flash',
            },
          },
        ),
      );
      global.fetch = fetchMock;
      try {
        const res = await call(registerAll(makeDeps()), 'thinker_routing_test', {
          agent: 'demo',
          as: 'openclaw',
          model: 'deepseek/flash',
        });
        expect(res.data).toMatchObject({
          ok: true,
          requested_model: 'deepseek/flash',
          routing_reason: 'virtual-model',
          virtual_model: 'DeepSeek/Flash',
          served_model: 'gpt-4o',
        });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).model).toBe('deepseek/flash');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('parses the responses surface', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'm',
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'RESP' }] }],
          }),
          { status: 200 },
        ),
      );
      try {
        const res = await call(registerAll(makeDeps()), 'thinker_routing_test', {
          agent: 'demo',
          as: 'codex',
        });
        expect(res.data).toMatchObject({ surface: 'responses', reply: 'RESP' });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('sends the header rule the custom tier stores, not a fixed header name', async () => {
      const originalFetch = global.fetch;
      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ model: 'gpt-4o', choices: [{ message: { content: 'OK' } }] }),
            { status: 200 },
          ),
        );
      global.fetch = fetchMock;
      try {
        const deps = makeDeps();
        (deps.headerTiers.list as jest.Mock).mockResolvedValue([
          // e.g. created by the CLI or the dashboard with its own header key
          {
            id: 'h1',
            name: 'Deep',
            header_key: 'x-team-route',
            header_value: 'deep-v2',
            enabled: true,
          },
        ]);
        const res = await call(registerAll(deps), 'thinker_routing_test', {
          agent: 'demo',
          as: 'openclaw',
          tier: 'deep',
        });
        expect(res.error).toBeFalsy();
        expect(res.data).toMatchObject({ tier: 'deep', tier_header: 'x-team-route: deep-v2' });
        const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
        expect(headers['x-team-route']).toBe('deep-v2');
        expect(Object.keys(headers).filter((h) => h.endsWith('-tier'))).toEqual([]);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('refuses to test an unknown or disabled custom tier without calling the gateway', async () => {
      const originalFetch = global.fetch;
      const fetchMock = jest.fn();
      global.fetch = fetchMock;
      try {
        const deps = makeDeps();
        (deps.headerTiers.list as jest.Mock).mockResolvedValue([
          {
            id: 'h1',
            name: 'deep',
            header_key: 'x-thinker-tier',
            header_value: 'deep',
            enabled: false,
          },
        ]);
        const tools = registerAll(deps);
        const unknown = await call(tools, 'thinker_routing_test', {
          agent: 'demo',
          as: 'openclaw',
          tier: 'nope',
        });
        expect(unknown.error).toBe(true);
        expect(JSON.stringify(unknown)).toContain('Custom tier \\"nope\\" not found');
        const disabled = await call(tools, 'thinker_routing_test', {
          agent: 'demo',
          as: 'openclaw',
          tier: 'deep',
        });
        expect(disabled.error).toBe(true);
        expect(JSON.stringify(disabled)).toContain('is disabled');
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('model tools', () => {
    it('lists models and prices (provider id or display name)', async () => {
      const tools = registerAll(makeDeps());
      expect((await call(tools, 'thinker_models_list', { agent: 'demo' })).error).toBeFalsy();
      expect(
        (await call(tools, 'thinker_model_prices', { provider: 'openai' })).data,
      ).toMatchObject({
        models: [{ model_name: 'gpt-4o' }],
      });
      expect((await call(tools, 'thinker_model_prices', {})).error).toBeFalsy();
      // A provider alias resolves to the provider entry in the label lookup.
      const aliasDeps = makeDeps();
      (aliasDeps.modelPrices.getAll as jest.Mock).mockReturnValue({
        models: [
          {
            model_name: 'bedrock-model',
            provider: 'bedrock',
            input_price_per_million: 1,
            output_price_per_million: 2,
            display_name: 'BM',
            validated: true,
          },
        ],
        lastSyncedAt: null,
      });
      expect(
        (await call(registerAll(aliasDeps), 'thinker_model_prices', { provider: 'aws-bedrock' }))
          .data,
      ).toMatchObject({ models: [{ provider: 'bedrock' }] });
    });
  });

  describe('request tools', () => {
    it('returns a page', async () => {
      const res = await call(registerAll(makeDeps()), 'thinker_requests_get', {
        agent: 'demo',
        status: 'success',
        origin: 'provider',
        limit: 10,
      });
      expect(res.data).toMatchObject({ next_cursor: 'c' });
    });
  });

  describe('identity tools', () => {
    it('reports whoami and a doctor verdict', async () => {
      const tools = registerAll(makeDeps());
      expect((await call(tools, 'thinker_whoami')).data).toMatchObject({ tenantId: TENANT });
      expect((await call(tools, 'thinker_doctor')).data).toMatchObject({ ok: true });

      const empty = makeDeps();
      (empty.providers.getProviders as jest.Mock).mockResolvedValue([]);
      (empty.timeseries.getAgentList as jest.Mock).mockResolvedValue([]);
      expect((await call(registerAll(empty), 'thinker_doctor')).data).toMatchObject({ ok: false });

      const hollow = makeDeps();
      (hollow.providers.getProviders as jest.Mock).mockResolvedValue([
        { ...CONNECTION, cached_models: [] },
      ]);
      expect((await call(registerAll(hollow), 'thinker_doctor')).data).toMatchObject({
        ok: false,
      });

      // Hollow connection with no label exercises the label-less branch.
      const hollowNoLabel = makeDeps();
      (hollowNoLabel.providers.getProviders as jest.Mock).mockResolvedValue([
        { ...CONNECTION, label: '', cached_models: [] },
      ]);
      expect((await call(registerAll(hollowNoLabel), 'thinker_doctor')).data).toMatchObject({
        ok: false,
      });
    });
  });

  describe('environment tools', () => {
    it('renders setup masked, revealed, and generic', async () => {
      const tools = registerAll(makeDeps());
      const masked = await call(tools, 'thinker_agent_setup', { agent: 'demo' });
      expect((masked.data as { setup: string }).setup).toContain('THINKER_AGENT_KEY');

      const revealed = await call(tools, 'thinker_agent_setup', { agent: 'demo', reveal: true });
      expect((revealed.data as { setup: string }).setup).not.toContain('THINKER_AGENT_KEY');

      const deps = makeDeps();
      (deps.lifecycle.findAgentInfo as jest.Mock).mockResolvedValue({
        agent_name: 'demo',
        display_name: 'Demo',
        agent_category: 'coding',
        agent_platform: 'unknown-platform',
      });
      const generic = await call(registerAll(deps), 'thinker_agent_setup', { agent: 'demo' });
      expect((generic.data as { setup: string }).setup).toContain('base URL');
    });

    it('rejects reveal without write scope and missing agents', async () => {
      const deps = makeDeps();
      (deps.lifecycle.findAgentInfo as jest.Mock).mockResolvedValueOnce(null);
      expect((await call(registerAll(deps), 'thinker_agent_setup', { agent: 'x' })).error).toBe(
        true,
      );

      const ro = registerAll(makeDeps(), { ...OPERATOR, scopes: new Set(['mcp:read']) });
      expect((await call(ro, 'thinker_agent_setup', { agent: 'demo', reveal: true })).error).toBe(
        true,
      );
      expect(ro.has('thinker_agent_env')).toBe(false);
      // Read-only generic setup omits the write-only env guidance.
      const roDeps = makeDeps();
      (roDeps.lifecycle.findAgentInfo as jest.Mock).mockResolvedValue({
        agent_name: 'demo',
        display_name: 'Demo',
        agent_category: 'coding',
        agent_platform: 'unknown-platform',
      });
      const roSetup = await call(
        registerAll(roDeps, { ...OPERATOR, scopes: new Set(['mcp:read']) }),
        'thinker_agent_setup',
        { agent: 'demo' },
      );
      expect((roSetup.data as { setup: string }).setup).not.toContain('thinker_agent_env');
    });

    it('returns env lines and the guide', async () => {
      const tools = registerAll(makeDeps());
      const env = await call(tools, 'thinker_agent_env', { agent: 'demo', export: true });
      expect((env.data as { lines: string[] }).lines[0]).toContain('export THINKER_AGENT_KEY=');
      expect((await call(tools, 'thinker_guide')).data).toHaveProperty('workflow');

      const deps = makeDeps();
      (deps.lifecycle.findAgentInfo as jest.Mock).mockResolvedValueOnce(null);
      expect((await call(registerAll(deps), 'thinker_agent_env', { agent: 'x' })).error).toBe(true);
      const deps2 = makeDeps();
      (deps2.apiKeys.getKeyForAgent as jest.Mock).mockResolvedValueOnce({ keyPrefix: 'p' });
      expect((await call(registerAll(deps2), 'thinker_agent_env', { agent: 'demo' })).error).toBe(
        true,
      );
    });
  });
});
