import type { Repository } from 'typeorm';
import type { ModelRoute } from 'thinker-shared';
import { ResolveService } from '../resolve.service';
import type { Agent } from '../../../entities/agent.entity';
import type { TierAssignment } from '../../../entities/tier-assignment.entity';
import type { VirtualModel } from '../../../entities/virtual-model.entity';
import type { TierService } from '../../routing-core/tier.service';
import type { ProviderKeyService } from '../../routing-core/provider-key.service';
import type { RoutingCacheService } from '../../routing-core/routing-cache.service';
import type { SpecificityService } from '../../routing-core/specificity.service';
import type { SpecificityPenaltyService } from '../../routing-core/specificity-penalty.service';
import type { VirtualModelService } from '../../virtual-models/virtual-model.service';
import type { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';

jest.mock('../../../scoring', () => ({
  scoreRequest: jest.fn(),
  scanMessages: jest.fn(),
}));

import { scoreRequest, scanMessages } from '../../../scoring';

const route = (provider: string, model: string, keyLabel?: string): ModelRoute =>
  keyLabel
    ? { provider, authType: 'api_key', model, keyLabel }
    : { provider, authType: 'api_key', model };

const vm = (overrides: Partial<VirtualModel> = {}): VirtualModel =>
  ({
    id: 'vm-1',
    tenant_id: 'tenant-1',
    agent_id: 'agent-1',
    name: 'DeepSeek/Flash',
    sort_order: 0,
    enabled: true,
    override_route: route('openai', 'gpt-4o'),
    fallback_routes: [route('anthropic', 'claude-opus-4-6')],
    continue_on_default: false,
    response_mode: 'buffered',
    output_modality: 'text',
    ...overrides,
  }) as VirtualModel;

const defaultTier = (overrides: Partial<TierAssignment> = {}): TierAssignment =>
  ({
    tier: 'default',
    override_route: route('deepseek', 'deepseek-chat'),
    auto_assigned_route: null,
    fallback_routes: null,
    ...overrides,
  }) as TierAssignment;

describe('ResolveService.resolveVirtualModel (ADR 0004)', () => {
  let tierService: { getTiers: jest.Mock };
  let providerKeyService: {
    isRouteAvailable: jest.Mock;
    hasRouteCredentials: jest.Mock;
    getDefaultKeyLabel: jest.Mock;
  };
  let virtualModelService: { list: jest.Mock };
  let svc: ResolveService;

  beforeEach(() => {
    jest.clearAllMocks();
    tierService = { getTiers: jest.fn().mockResolvedValue([]) };
    providerKeyService = {
      isRouteAvailable: jest.fn().mockResolvedValue(true),
      hasRouteCredentials: jest.fn().mockResolvedValue(true),
      getDefaultKeyLabel: jest.fn().mockResolvedValue(undefined),
    };
    virtualModelService = { list: jest.fn().mockResolvedValue([vm()]) };
    svc = new ResolveService(
      tierService as unknown as TierService,
      providerKeyService as unknown as ProviderKeyService,
      { getActiveAssignments: jest.fn() } as unknown as SpecificityService,
      {
        getModelForAgent: jest.fn(),
        invalidate: jest.fn(),
        invalidateTenant: jest.fn(),
      } as unknown as ModelDiscoveryService,
      { getPenaltiesForAgent: jest.fn() } as unknown as SpecificityPenaltyService,
      { findOne: jest.fn() } as unknown as Repository<Agent>,
      {
        addInvalidationListener: jest.fn(),
        addTenantInvalidationListener: jest.fn(),
      } as unknown as RoutingCacheService,
      virtualModelService as unknown as VirtualModelService,
    );
  });

  const resolveVm = (model = 'deepseek/flash') =>
    svc.resolveVirtualModel('agent-1', 'tenant-1', model);

  describe('matching', () => {
    it('matches the name ignoring case, with no other normalization', async () => {
      expect(await resolveVm('DEEPSEEK/FLASH')).not.toBeNull();
      expect(await resolveVm('deepseek/flash ')).toBeNull();
      expect(await resolveVm('openai/deepseek/flash')).toBeNull();
      expect(await resolveVm('flash')).toBeNull();
    });

    it('ignores a disabled virtual model, so it shadows nothing', async () => {
      virtualModelService.list.mockResolvedValue([vm({ enabled: false })]);
      expect(await resolveVm()).toBeNull();
    });

    it('never matches a row of another agent or tenant', async () => {
      virtualModelService.list.mockResolvedValue([
        vm({ agent_id: 'agent-2' }),
        vm({ id: 'vm-2', tenant_id: 'tenant-2' }),
      ]);
      expect(await resolveVm()).toBeNull();
    });

    it('shadows a bare native model id', async () => {
      virtualModelService.list.mockResolvedValue([
        vm({ name: 'claude-sonnet-4-5', override_route: route('anthropic', 'claude-sonnet-4-5') }),
      ]);
      const result = await resolveVm('claude-sonnet-4-5');
      expect(result?.route).toEqual(route('anthropic', 'claude-sonnet-4-5'));
      expect(result?.reason).toBe('virtual-model');
    });
  });

  it('returns the virtual chain with its own transport, modality and scope', async () => {
    virtualModelService.list.mockResolvedValue([vm({ output_modality: 'text' })]);

    const result = await resolveVm();

    expect(result).toMatchObject({
      tier: 'default',
      reason: 'virtual-model',
      confidence: 1,
      response_mode: 'buffered',
      output_modality: 'text',
      virtual_model_id: 'vm-1',
      virtual_model_name: 'DeepSeek/Flash',
      route: route('openai', 'gpt-4o'),
      fallback_routes: [route('anthropic', 'claude-opus-4-6')],
    });
    expect(result?.route_params_scopes?.map((s) => s.paramsScope)).toEqual([
      'virtual:vm-1',
      'virtual:vm-1',
    ]);
    // No scorer, no specificity.
    expect(scoreRequest).not.toHaveBeenCalled();
    expect(scanMessages).not.toHaveBeenCalled();
  });

  it('skips an unavailable route and promotes the next one', async () => {
    providerKeyService.isRouteAvailable.mockImplementation(
      async (_t: string, r: ModelRoute) => r.model !== 'gpt-4o',
    );

    const result = await resolveVm();

    expect(result?.route).toEqual(route('anthropic', 'claude-opus-4-6'));
    expect(result?.fallback_routes).toBeNull();
  });

  describe('continue_on_default off', () => {
    it('signals M301 when no route of the virtual is available', async () => {
      providerKeyService.isRouteAvailable.mockResolvedValue(false);
      tierService.getTiers.mockResolvedValue([defaultTier()]);

      const result = await resolveVm();

      expect(result).toMatchObject({
        route: null,
        fallback_routes: null,
        reason: 'virtual-model',
        virtual_model_id: 'vm-1',
        virtual_model_unavailable: 'DeepSeek/Flash',
        virtual_model_continues_on_default: false,
      });
      // The Default tier is never read with the option off.
      expect(tierService.getTiers).not.toHaveBeenCalled();
    });

    it('signals M301 for a virtual with no routes at all', async () => {
      virtualModelService.list.mockResolvedValue([
        vm({ override_route: null, fallback_routes: null }),
      ]);
      expect((await resolveVm())?.virtual_model_unavailable).toBe('DeepSeek/Flash');
    });
  });

  describe('continue_on_default on', () => {
    beforeEach(() => {
      virtualModelService.list.mockResolvedValue([vm({ continue_on_default: true })]);
    });

    it('appends the Default chain under tier:default', async () => {
      tierService.getTiers.mockResolvedValue([
        defaultTier({ fallback_routes: [route('mistral', 'mistral-large')] }),
      ]);

      const result = await resolveVm();

      expect(result?.fallback_routes?.map((r) => r.model)).toEqual([
        'claude-opus-4-6',
        'deepseek-chat',
        'mistral-large',
      ]);
      expect(result?.route_params_scopes?.map((s) => s.paramsScope)).toEqual([
        'virtual:vm-1',
        'virtual:vm-1',
        'tier:default',
        'tier:default',
      ]);
    });

    it('takes the primary from the Default when the whole virtual is unavailable', async () => {
      tierService.getTiers.mockResolvedValue([defaultTier()]);
      providerKeyService.isRouteAvailable.mockImplementation(
        async (_t: string, r: ModelRoute) => r.provider === 'deepseek',
      );

      const result = await resolveVm();

      expect(result?.route).toEqual(route('deepseek', 'deepseek-chat'));
      expect(result?.route_params_scopes).toEqual([
        { route: route('deepseek', 'deepseek-chat'), paramsScope: 'tier:default' },
      ]);
    });

    it('reaches a Default that only has the legacy auto-assigned route', async () => {
      tierService.getTiers.mockResolvedValue([
        defaultTier({ override_route: null, auto_assigned_route: route('legacy', 'old-model') }),
      ]);
      // The auto-assigned route is not in discovery, but it has credentials:
      // buildResolvedRouteChain would route to it, so the virtual does too.
      providerKeyService.isRouteAvailable.mockResolvedValue(false);
      providerKeyService.hasRouteCredentials.mockResolvedValue(true);

      const result = await resolveVm();

      expect(result?.route).toEqual(route('legacy', 'old-model'));
      expect(result?.virtual_model_unavailable).toBeUndefined();
    });

    it('signals M301 when the Default is empty too', async () => {
      tierService.getTiers.mockResolvedValue([
        defaultTier({ override_route: null, auto_assigned_route: null, fallback_routes: null }),
      ]);
      providerKeyService.isRouteAvailable.mockResolvedValue(false);

      const result = await resolveVm();
      expect(result?.virtual_model_unavailable).toBe('DeepSeek/Flash');
      expect(result?.virtual_model_continues_on_default).toBe(true);
    });

    it('signals M301 when the agent has no Default row', async () => {
      tierService.getTiers.mockResolvedValue([]);
      providerKeyService.isRouteAvailable.mockResolvedValue(false);

      expect((await resolveVm())?.virtual_model_unavailable).toBe('DeepSeek/Flash');
    });

    it('collapses a route without a label into the same route with the default key label', async () => {
      // The default key of openai is "Main": (openai, gpt-4o, none) and
      // (openai, gpt-4o, "Main") are the same route once normalized.
      providerKeyService.getDefaultKeyLabel.mockImplementation(
        async (_t: string, provider: string) => (provider === 'openai' ? 'Main' : undefined),
      );
      tierService.getTiers.mockResolvedValue([
        defaultTier({ override_route: route('openai', 'gpt-4o', 'Main') }),
      ]);

      const result = await resolveVm();

      expect(result?.route).toEqual(route('openai', 'gpt-4o', 'Main'));
      expect(result?.fallback_routes).toEqual([route('anthropic', 'claude-opus-4-6')]);
    });

    it('keeps the same model on another key as a separate route', async () => {
      providerKeyService.getDefaultKeyLabel.mockImplementation(
        async (_t: string, provider: string) => (provider === 'openai' ? 'Main' : undefined),
      );
      tierService.getTiers.mockResolvedValue([
        defaultTier({ override_route: route('openai', 'gpt-4o', 'Work') }),
      ]);

      const result = await resolveVm();

      expect(result?.fallback_routes).toEqual([
        route('anthropic', 'claude-opus-4-6'),
        route('openai', 'gpt-4o', 'Work'),
      ]);
      expect(result?.route_params_scopes?.[2].paramsScope).toBe('tier:default');
    });

    it('filters the whole chain, Default part included, by the virtual response mode', async () => {
      virtualModelService.list.mockResolvedValue([
        vm({
          continue_on_default: true,
          response_mode: 'stream',
          override_route: route('openai', 'gpt-image-1'),
          fallback_routes: null,
        }),
      ]);
      tierService.getTiers.mockResolvedValue([
        defaultTier({
          override_route: route('openai', 'tts-1'),
          fallback_routes: [route('deepseek', 'deepseek-chat')],
        }),
      ]);

      const result = await resolveVm();

      expect(result?.response_mode).toBe('stream');
      expect(result?.route).toEqual(route('deepseek', 'deepseek-chat'));
      expect(result?.fallback_routes).toBeNull();
      expect(result?.route_params_scopes?.map((s) => s.paramsScope)).toEqual(['tier:default']);
    });

    it('signals M301 when the response mode leaves no route', async () => {
      virtualModelService.list.mockResolvedValue([
        vm({
          response_mode: 'stream',
          override_route: route('openai', 'gpt-image-1'),
          fallback_routes: null,
        }),
      ]);

      const result = await resolveVm();

      expect(result?.route).toBeNull();
      expect(result?.virtual_model_unavailable).toBe('DeepSeek/Flash');
    });
  });
});
