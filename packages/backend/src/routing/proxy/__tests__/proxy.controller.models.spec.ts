/**
 * `GET /v1/models` with virtual models and `context_length` (ADR 0004,
 * section 7). The routing facts come from ModelListRoutingService, mocked
 * here; its own computation is covered by model-list-routing.service.spec.ts
 * and model-list-context.spec.ts.
 */
import { ProxyController } from '../proxy.controller';
import type { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import type { ModelListRouting } from '../../virtual-models/model-list-routing.service';

function makeModel(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    inputPricePerToken: 0.0000025,
    outputPricePerToken: 0.00001,
    capabilityReasoning: false,
    capabilityCode: false,
    qualityScore: 4,
    authType: 'api_key',
    ...overrides,
  };
}

const request = (tenantId = 'tenant-1', agentId = 'agent-1') =>
  ({
    ingestionContext: { userId: 'user-1', tenantId, agentId, agentName: 'test-agent' },
    headers: {},
  }) as never;

describe('ProxyController.models with virtual models', () => {
  let modelDiscovery: { getModelsForAgent: jest.Mock };
  let modelListRouting: { forAgent: jest.Mock };
  let controller: ProxyController;

  const build = (withRouting = true) =>
    new ProxyController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      modelDiscovery as never,
      { getCapabilities: jest.fn().mockResolvedValue(null) } as never,
      { lookupModelCapabilities: jest.fn().mockReturnValue(null) } as never,
      undefined,
      undefined,
      withRouting ? (modelListRouting as never) : undefined,
    );

  const routing = (value: ModelListRouting) => modelListRouting.forAgent.mockResolvedValue(value);

  beforeEach(() => {
    modelDiscovery = {
      getModelsForAgent: jest.fn().mockResolvedValue([
        makeModel({ id: 'gpt-4o', provider: 'openai' }),
        makeModel({ id: 'deepseek-chat', provider: 'deepseek', contextWindow: 64000 }),
        makeModel({ id: 'custom:cp-1/model-a', provider: 'custom:cp-1' }),
        makeModel({
          id: 'custom:cp-2/qwen',
          provider: 'custom:cp-2',
          providerName: 'Gateway',
          providerAlias: 'gw',
        }),
      ]),
    };
    modelListRouting = {
      forAgent: jest.fn().mockResolvedValue({ autoContextLength: null, virtuals: [] }),
    };
    controller = build();
  });

  it('lists auto, then enabled virtual models in the order given, then real models', async () => {
    routing({
      autoContextLength: 64000,
      virtuals: [
        { name: 'deepseek/flash', context_length: 64000 },
        { name: 'fast', context_length: 128000 },
      ],
    });

    const res = await controller.models(request());

    expect(res.data).toEqual([
      { id: 'auto', object: 'model', created: 0, owned_by: 'thinker', context_length: 64000 },
      {
        id: 'deepseek/flash',
        object: 'model',
        created: 0,
        owned_by: 'thinker',
        context_length: 64000,
      },
      { id: 'fast', object: 'model', created: 0, owned_by: 'thinker', context_length: 128000 },
      { id: 'openai/gpt-4o', object: 'model', created: 0, owned_by: 'openai' },
      { id: 'deepseek/deepseek-chat', object: 'model', created: 0, owned_by: 'deepseek' },
      { id: 'custom:cp-1/model-a', object: 'model', created: 0, owned_by: 'custom:cp-1' },
      { id: 'gw/qwen', object: 'model', created: 0, owned_by: 'Gateway' },
    ]);
  });

  it('judges everything from one catalog snapshot of the key agent', async () => {
    await controller.models(request('tenant-9', 'agent-9'));

    expect(modelDiscovery.getModelsForAgent).toHaveBeenCalledTimes(1);
    expect(modelDiscovery.getModelsForAgent).toHaveBeenCalledWith('tenant-9', 'agent-9');
    const snapshot = await modelDiscovery.getModelsForAgent.mock.results[0].value;
    expect(modelListRouting.forAgent).toHaveBeenCalledWith('agent-9', 'tenant-9', snapshot);
  });

  it('hides a real model whose public id equals a virtual name, ignoring case', async () => {
    routing({
      autoContextLength: null,
      virtuals: [
        { name: 'OpenAI/GPT-4o', context_length: 128000 },
        // A custom provider without an alias publishes custom:<uuid>/<model>.
        { name: 'CUSTOM:cp-1/Model-A', context_length: null },
        // With an alias only the alias id is public, and that is what hides.
        { name: 'gw/qwen', context_length: null },
      ],
    });

    const ids = (await controller.models(request())).data.map((m) => m.id);

    expect(ids).toEqual([
      'auto',
      'OpenAI/GPT-4o',
      'CUSTOM:cp-1/Model-A',
      'gw/qwen',
      'deepseek/deepseek-chat',
    ]);
  });

  it('does not hide a different spelling of the same model', async () => {
    // A bare native id is not the public id `openai/gpt-4o`.
    routing({ autoContextLength: null, virtuals: [{ name: 'gpt-4o', context_length: null }] });

    const ids = (await controller.models(request())).data.map((m) => m.id);

    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('openai/gpt-4o');
  });

  it('omits context_length (not null) when the window is unknown', async () => {
    routing({ autoContextLength: null, virtuals: [{ name: 'mystery', context_length: null }] });

    const [auto, virtual] = (await controller.models(request())).data;

    expect(auto).not.toHaveProperty('context_length');
    expect(virtual).toEqual({ id: 'mystery', object: 'model', created: 0, owned_by: 'thinker' });
  });

  it('keeps real models without context_length', async () => {
    routing({ autoContextLength: 64000, virtuals: [] });

    const reals = (await controller.models(request())).data.slice(1);

    for (const entry of reals) expect(entry).not.toHaveProperty('context_length');
  });

  it('never adds capabilities, cost or route metadata to auto and virtual models', async () => {
    routing({
      autoContextLength: 64000,
      virtuals: [{ name: 'deepseek/flash', context_length: 64000 }],
    });

    const res = await controller.models(request(), 'true', 'true', 'true');

    const [auto, virtual, real] = res.data;
    expect(auto).toEqual({
      id: 'auto',
      object: 'model',
      created: 0,
      owned_by: 'thinker',
      context_length: 64000,
    });
    expect(virtual).toEqual({
      id: 'deepseek/flash',
      object: 'model',
      created: 0,
      owned_by: 'thinker',
      context_length: 64000,
    });
    // The real models still carry what the flags ask for.
    expect(real).toMatchObject({
      id: 'openai/gpt-4o',
      provider_model_id: 'gpt-4o',
      auth_type: 'api_key',
      cost: { input: 2.5, output: 10 },
    });
  });

  it('falls back to the plain listing when the routing service is absent', async () => {
    controller = build(false);

    const res = await controller.models(request());

    expect(res.data[0]).toEqual({ id: 'auto', object: 'model', created: 0, owned_by: 'thinker' });
    expect(res.data).toHaveLength(5);
  });
});
