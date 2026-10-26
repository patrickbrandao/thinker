import type { ModelRoute } from 'thinker-shared';
import type { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import { ModelListRoutingService } from '../model-list-routing.service';

const route = (provider: string, model: string): ModelRoute => ({
  provider,
  authType: 'api_key',
  model,
});

const discovered = (id: string, provider: string, contextWindow: number): DiscoveredModel =>
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

const CATALOG = [
  discovered('gpt-4o', 'openai', 128000),
  discovered('deepseek-chat', 'deepseek', 64000),
  discovered('claude-sonnet-4-5', 'anthropic', 200000),
];

const tierRow = (tier: string, override: ModelRoute | null = null) => ({
  tier,
  override_route: override,
  auto_assigned_route: null,
  fallback_routes: null,
  response_mode: 'buffered',
});

const vmRow = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${name}`,
  agent_id: 'agent-1',
  name,
  enabled: true,
  override_route: route('openai', 'gpt-4o'),
  fallback_routes: null,
  continue_on_default: false,
  response_mode: 'buffered',
  ...overrides,
});

describe('ModelListRoutingService', () => {
  let virtualModels: { list: jest.Mock };
  let tierService: { getTiers: jest.Mock };
  let specificityService: { getActiveAssignments: jest.Mock };
  let agentRepo: { findOne: jest.Mock };
  let service: ModelListRoutingService;

  beforeEach(() => {
    virtualModels = { list: jest.fn().mockResolvedValue([]) };
    tierService = {
      getTiers: jest
        .fn()
        .mockResolvedValue([
          tierRow('simple', route('anthropic', 'claude-sonnet-4-5')),
          tierRow('standard'),
          tierRow('complex'),
          tierRow('reasoning'),
          tierRow('default', route('deepseek', 'deepseek-chat')),
        ]),
    };
    specificityService = { getActiveAssignments: jest.fn().mockResolvedValue([]) };
    agentRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'agent-1', complexity_routing_enabled: false }),
    };
    service = new ModelListRoutingService(
      virtualModels as never,
      tierService as never,
      specificityService as never,
      agentRepo as never,
    );
  });

  it('lists only enabled virtual models, in the cached order', async () => {
    virtualModels.list.mockResolvedValue([
      vmRow('b-first'),
      vmRow('disabled', { enabled: false }),
      vmRow('a-second', { override_route: route('anthropic', 'claude-sonnet-4-5') }),
    ]);

    const res = await service.forAgent('agent-1', 'tenant-1', CATALOG);

    expect(res.virtuals).toEqual([
      { name: 'b-first', context_length: 128000 },
      { name: 'a-second', context_length: 200000 },
    ]);
    expect(virtualModels.list).toHaveBeenCalledWith('agent-1');
  });

  it('adds the Default chain to a virtual model with continue_on_default', async () => {
    virtualModels.list.mockResolvedValue([
      vmRow('with-default', { continue_on_default: true }),
      vmRow('without-default'),
    ]);

    const res = await service.forAgent('agent-1', 'tenant-1', CATALOG);

    expect(res.virtuals).toEqual([
      { name: 'with-default', context_length: 64000 },
      { name: 'without-default', context_length: 128000 },
    ]);
  });

  it('reads the agent within its tenant', async () => {
    await service.forAgent('agent-1', 'tenant-1', CATALOG);

    expect(agentRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'agent-1', tenant_id: 'tenant-1' } }),
    );
  });

  it('uses the Default chain for auto with complexity routing off', async () => {
    const res = await service.forAgent('agent-1', 'tenant-1', CATALOG);

    expect(res.autoContextLength).toBe(64000);
    expect(specificityService.getActiveAssignments).not.toHaveBeenCalled();
  });

  it('takes every slot and active specificity into account with complexity routing on', async () => {
    agentRepo.findOne.mockResolvedValue({ id: 'agent-1', complexity_routing_enabled: true });
    tierService.getTiers.mockResolvedValue([
      tierRow('simple', route('anthropic', 'claude-sonnet-4-5')),
      tierRow('standard'),
      tierRow('complex'),
      tierRow('reasoning'),
      tierRow('default', route('openai', 'gpt-4o')),
    ]);
    specificityService.getActiveAssignments.mockResolvedValue([
      {
        override_route: route('deepseek', 'deepseek-chat'),
        fallback_routes: null,
        response_mode: 'buffered',
      },
    ]);

    const res = await service.forAgent('agent-1', 'tenant-1', CATALOG);

    expect(res.autoContextLength).toBe(64000);
    expect(specificityService.getActiveAssignments).toHaveBeenCalledWith('agent-1');
  });
});
