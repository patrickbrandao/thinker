import { ModelListController } from '../model-list.controller';
import type { ModelListRoutingService, ModelListRouting } from '../model-list-routing.service';
import type { VirtualModelService } from '../virtual-model.service';
import type { ResolveAgentService } from '../../routing-core/resolve-agent.service';
import type { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import type { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import type { TenantContext } from '../../../common/decorators/tenant-context.decorator';

const model = (id: string, provider = 'openai'): DiscoveredModel => ({
  id,
  displayName: id.toUpperCase(),
  provider,
  contextWindow: 128000,
  inputPricePerToken: 0.000001,
  outputPricePerToken: 0.000002,
  capabilityReasoning: true,
  capabilityCode: false,
  qualityScore: 1,
  authType: 'api_key',
});

function makeController(routing: ModelListRouting, catalog: DiscoveredModel[]) {
  const resolve = {
    resolve: jest.fn().mockResolvedValue({ id: 'agent-1', tenant_id: 'tenant-1' }),
  } as unknown as ResolveAgentService;
  const discovery = {
    getModelsForAgent: jest.fn().mockResolvedValue(catalog),
  } as unknown as ModelDiscoveryService;
  const listRouting = {
    forAgent: jest.fn().mockResolvedValue(routing),
  } as unknown as ModelListRoutingService;
  const virtuals = {
    list: jest.fn().mockResolvedValue([
      {
        name: 'deepseek',
        enabled: true,
        override_route: { provider: 'deepseek', authType: 'api_key', model: 'deepseek-chat' },
        fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-5.5' }],
        continue_on_default: true,
        response_mode: 'stream',
      },
    ]),
  } as unknown as VirtualModelService;
  return new ModelListController(resolve, discovery, listRouting, virtuals);
}

const ctx: TenantContext = { tenantId: 'tenant-1', userId: 'user-1' };

describe('ModelListController', () => {
  it('lists auto, the virtual models and the real models in /v1/models order', async () => {
    const controller = makeController(
      {
        autoContextLength: 64000,
        virtuals: [{ name: 'deepseek', context_length: 32000 }],
      },
      [model('gpt-5.5'), model('deepseek', 'custom:x')],
    );
    const result = await controller.list(ctx, 'demo');
    expect(result.listing).toBe('open');
    expect(result.data.map((m) => [m.id, m.kind])).toEqual([
      ['auto', 'auto'],
      ['deepseek', 'virtual'],
      ['openai/gpt-5.5', 'model'],
    ]);
    expect(result.data[0]!.context_length).toBe(64000);
    expect(result.data[1]).toMatchObject({
      context_length: 32000,
      primary: { model: 'deepseek-chat' },
      fallbacks: [{ model: 'gpt-5.5' }],
      continue_on_default: true,
      response_mode: 'stream',
    });
    expect(result.data[2]).toMatchObject({
      owned_by: 'openai',
      display_name: 'GPT-5.5',
      provider_model_id: 'gpt-5.5',
      input_price_per_token: 0.000001,
      reasoning: true,
    });
  });

  it('stops at auto and the virtual models when the listing is closed', async () => {
    const controller = makeController(
      { listing: 'closed', autoContextLength: null, virtuals: [] },
      [model('gpt-5.5')],
    );
    const result = await controller.list(ctx, 'demo');
    expect(result.listing).toBe('closed');
    expect(result.data.map((m) => m.id)).toEqual(['auto']);
  });
});
