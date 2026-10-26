import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { ModelRoute } from 'thinker-shared';
import { VirtualModelService } from '../virtual-model.service';
import { VirtualModel } from '../../../entities/virtual-model.entity';
import { AgentModelParams } from '../../../entities/agent-model-params.entity';
import type { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import type { RoutingCacheService } from '../../routing-core/routing-cache.service';
import type { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import type { ProviderKeyService } from '../../routing-core/provider-key.service';
import type { TierService } from '../../routing-core/tier.service';

const route = (
  provider: string,
  model: string,
  authType: ModelRoute['authType'] = 'api_key',
): ModelRoute => ({ provider, authType, model });

const discovered = (
  id: string,
  provider: string,
  contextWindow = 0,
  authType: ModelRoute['authType'] = 'api_key',
): DiscoveredModel =>
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
    authType,
  }) as DiscoveredModel;

const CATALOG = [
  discovered('gpt-4o', 'openai', 128000),
  discovered('gpt-4o-mini', 'openai', 128000),
  discovered('claude-opus-4-6', 'anthropic', 200000),
  discovered('deepseek-chat', 'deepseek', 64000),
];

const row = (overrides: Partial<VirtualModel> = {}): VirtualModel =>
  Object.assign(new VirtualModel(), {
    id: 'vm-1',
    tenant_id: 'tenant-1',
    agent_id: 'agent-1',
    name: 'deepseek/flash',
    sort_order: 0,
    enabled: true,
    override_route: null,
    fallback_routes: null,
    continue_on_default: false,
    response_mode: 'buffered',
    output_modality: 'text',
    created_at: '2026-10-25T00:00:00.000Z',
    updated_at: '2026-10-25T00:00:00.000Z',
    ...overrides,
  });

const makeRepo = () => {
  const manager = {
    delete: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn(),
  };
  manager.transaction.mockImplementation(async (fn: (m: typeof manager) => Promise<void>) =>
    fn(manager),
  );
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockImplementation(async (r) => r),
    manager,
  };
};

describe('VirtualModelService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let routingCache: {
    getVirtualModels: jest.Mock;
    setVirtualModels: jest.Mock;
    invalidateAgent: jest.Mock;
  };
  let discovery: { getModelsForAgent: jest.Mock };
  let providerKeys: { getProviderKeys: jest.Mock; getRouteProviderRecords: jest.Mock };
  let tiers: { getTiers: jest.Mock };
  let svc: VirtualModelService;

  beforeEach(() => {
    repo = makeRepo();
    routingCache = {
      getVirtualModels: jest.fn().mockReturnValue(null),
      setVirtualModels: jest.fn(),
      invalidateAgent: jest.fn(),
    };
    discovery = { getModelsForAgent: jest.fn().mockResolvedValue(CATALOG) };
    providerKeys = {
      getProviderKeys: jest.fn().mockResolvedValue([
        { id: 'k1', label: 'Default', priority: 0, apiKey: 'x', region: null },
        { id: 'k2', label: 'Work', priority: 1, apiKey: 'y', region: null },
      ]),
      // Mistral is connected with cold discovery (no models in CATALOG).
      getRouteProviderRecords: jest.fn().mockResolvedValue(
        ['openai', 'anthropic', 'deepseek', 'mistral'].map((provider) => ({
          provider,
          authType: 'api_key',
        })),
      ),
    };
    tiers = { getTiers: jest.fn().mockResolvedValue([]) };
    svc = new VirtualModelService(
      repo as unknown as Repository<VirtualModel>,
      routingCache as unknown as RoutingCacheService,
      discovery as unknown as ModelDiscoveryService,
      providerKeys as unknown as ProviderKeyService,
      tiers as unknown as TierService,
    );
  });

  describe('list', () => {
    it('serves the cached rows', async () => {
      const cached = [row()];
      routingCache.getVirtualModels.mockReturnValue(cached);
      expect(await svc.list('agent-1')).toBe(cached);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('reads by agent, sorts by sort_order then name, and caches', async () => {
      repo.find.mockResolvedValue([
        row({ id: 'c', name: 'zeta', sort_order: 1 }),
        row({ id: 'b', name: 'beta', sort_order: 0 }),
        row({ id: 'a', name: 'alpha', sort_order: 0 }),
      ]);
      const rows = await svc.list('agent-1');
      expect(repo.find).toHaveBeenCalledWith({ where: { agent_id: 'agent-1' } });
      expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect(routingCache.setVirtualModels).toHaveBeenCalledWith('agent-1', rows);
    });
  });

  describe('listViews', () => {
    it('returns [] without touching discovery when there are no rows', async () => {
      expect(await svc.listViews('agent-1', 'tenant-1')).toEqual([]);
      expect(discovery.getModelsForAgent).not.toHaveBeenCalled();
    });

    it('adds shadows and context_length from one catalog snapshot, without tenant_id', async () => {
      repo.find.mockResolvedValue([
        row({
          id: 'a',
          name: 'GPT-4O',
          override_route: route('openai', 'gpt-4o'),
          fallback_routes: [route('anthropic', 'claude-opus-4-6')],
        }),
        row({ id: 'b', name: 'empty', sort_order: 1 }),
      ]);
      const [first, second] = await svc.listViews('agent-1', 'tenant-1');
      expect(discovery.getModelsForAgent).toHaveBeenCalledTimes(1);
      expect(discovery.getModelsForAgent).toHaveBeenCalledWith('tenant-1', 'agent-1');
      expect(first).toMatchObject({ id: 'a', shadows: ['gpt-4o'], context_length: 128000 });
      expect(first).not.toHaveProperty('tenant_id');
      expect(second).toMatchObject({ id: 'b', shadows: [], context_length: null });
      expect(tiers.getTiers).not.toHaveBeenCalled();
    });

    it('includes the Default chain in context_length when continue_on_default is on', async () => {
      repo.find.mockResolvedValue([
        row({ override_route: route('openai', 'gpt-4o'), continue_on_default: true }),
      ]);
      tiers.getTiers.mockResolvedValue([
        {
          tier: 'default',
          override_route: route('deepseek', 'deepseek-chat'),
          auto_assigned_route: null,
          fallback_routes: null,
        },
      ]);
      const [view] = await svc.listViews('agent-1', 'tenant-1');
      expect(view.context_length).toBe(64000);
    });

    it('ignores a stored legacy auto-assigned route while the Default override is available', async () => {
      repo.find.mockResolvedValue([
        row({ override_route: route('openai', 'gpt-4o'), continue_on_default: true }),
      ]);
      // The legacy route has an unknown window: reaching it would null the result.
      tiers.getTiers.mockResolvedValue([
        {
          tier: 'default',
          override_route: route('deepseek', 'deepseek-chat'),
          auto_assigned_route: route('mistral', 'legacy'),
          fallback_routes: null,
        },
      ]);
      const [view] = await svc.listViews('agent-1', 'tenant-1');
      expect(view.context_length).toBe(64000);
    });

    it('loads the credential rows once per request, within the tenant', async () => {
      repo.find.mockResolvedValue([
        row({ id: 'a', override_route: route('openai', 'gpt-4o') }),
        row({ id: 'b', name: 'other', override_route: route('mistral', 'm') }),
      ]);
      await svc.listViews('agent-1', 'tenant-1');
      expect(providerKeys.getRouteProviderRecords).toHaveBeenCalledTimes(1);
      expect(providerKeys.getRouteProviderRecords).toHaveBeenCalledWith('tenant-1', 'agent-1');
    });

    it('is not routable when its provider is disconnected or disabled for the agent', async () => {
      providerKeys.getRouteProviderRecords.mockResolvedValue([
        { provider: 'openai', authType: 'api_key' },
      ]);
      discovery.getModelsForAgent.mockResolvedValue(CATALOG.filter((m) => m.provider === 'openai'));
      repo.find.mockResolvedValue([
        row({ id: 'gone', override_route: route('deepseek', 'deepseek-chat') }),
        row({
          id: 'mixed',
          name: 'mixed',
          sort_order: 1,
          override_route: route('deepseek', 'deepseek-chat'),
          fallback_routes: [route('openai', 'gpt-4o')],
        }),
      ]);
      const [gone, mixed] = await svc.listViews('agent-1', 'tenant-1');
      expect(gone).toMatchObject({ routable: false, context_length: null });
      // The disconnected primary does not count toward the window.
      expect(mixed).toMatchObject({ routable: true, context_length: 128000 });
    });

    it('stays routable on cold discovery of a connected provider', async () => {
      repo.find.mockResolvedValue([row({ override_route: route('mistral', 'mistral-large') })]);
      const [view] = await svc.listViews('agent-1', 'tenant-1');
      expect(view).toMatchObject({ routable: true, context_length: null });
    });

    it('reaches the auto-assigned route when the Default override is unavailable', async () => {
      repo.find.mockResolvedValue([
        row({ override_route: route('openai', 'gpt-4o'), continue_on_default: true }),
      ]);
      discovery.getModelsForAgent.mockResolvedValue([
        ...CATALOG,
        discovered('small', 'anthropic', 32000),
      ]);
      tiers.getTiers.mockResolvedValue([
        {
          tier: 'default',
          override_route: route('deepseek', 'gone-model'),
          auto_assigned_route: route('anthropic', 'small'),
          fallback_routes: null,
        },
      ]);
      const [view] = await svc.listViews('agent-1', 'tenant-1');
      expect(view.context_length).toBe(32000);
    });
  });

  describe('create', () => {
    it('creates with defaults, appends after the highest sort_order and invalidates', async () => {
      repo.find.mockResolvedValue([row({ id: 'x', name: 'other', sort_order: 4 })]);
      const view = await svc.create('agent-1', 'tenant-1', { name: ' DeepSeek/Flash ' });
      expect(repo.insert).toHaveBeenCalledTimes(1);
      const inserted = repo.insert.mock.calls[0][0] as VirtualModel;
      expect(inserted).toMatchObject({
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        name: 'DeepSeek/Flash',
        sort_order: 5,
        enabled: true,
        continue_on_default: false,
        response_mode: 'buffered',
        output_modality: 'text',
        override_route: null,
        fallback_routes: null,
      });
      expect(view.name).toBe('DeepSeek/Flash');
      expect(routingCache.invalidateAgent).toHaveBeenCalledWith('agent-1');
    });

    it.each([
      ['', 'Name is required'],
      ['/bad', 'Name can only contain'],
      ['a'.repeat(65), '64 characters'],
      ['AUTO', 'reserved'],
    ])('rejects the name %j with a 400', async (name, message) => {
      const err = await svc.create('agent-1', 'tenant-1', { name }).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain(message);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('rejects a duplicate name ignoring case, disabled rows included, with a 409', async () => {
      repo.find.mockResolvedValue([row({ name: 'DeepSeek', enabled: false })]);
      const err = await svc.create('agent-1', 'tenant-1', { name: 'deepseek' }).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('A virtual model named "deepseek" already exists on this agent');
    });

    it('maps a unique-index race to the same 409', async () => {
      repo.insert.mockRejectedValue({ code: '23505', constraint: 'IDX_virtual_models_agent_name' });
      await expect(svc.create('agent-1', 'tenant-1', { name: 'deepseek' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows other insert errors', async () => {
      repo.insert.mockRejectedValue(new Error('boom'));
      await expect(svc.create('agent-1', 'tenant-1', { name: 'deepseek' })).rejects.toThrow('boom');
    });

    it('resolves the primary and fallbacks to canonical routes without a key label', async () => {
      await svc.create('agent-1', 'tenant-1', {
        name: 'mix',
        override_route: { model: 'openai/gpt-4o' },
        fallback_routes: [{ model: 'claude-opus-4-6' }, { model: 'deepseek-chat' }],
        continue_on_default: true,
      });
      const inserted = repo.insert.mock.calls[0][0] as VirtualModel;
      expect(inserted.override_route).toEqual(route('openai', 'gpt-4o'));
      expect(inserted.fallback_routes).toEqual([
        route('anthropic', 'claude-opus-4-6'),
        route('deepseek', 'deepseek-chat'),
      ]);
      expect(inserted.continue_on_default).toBe(true);
      expect(providerKeys.getProviderKeys).not.toHaveBeenCalled();
      // One discovery snapshot for validation and the returned view.
      expect(discovery.getModelsForAgent).toHaveBeenCalledTimes(1);
    });

    it('rejects a primary that no enabled provider offers with a 400 naming the model', async () => {
      const err = await svc
        .create('agent-1', 'tenant-1', {
          name: 'x',
          override_route: { model: 'gpt-9', provider: 'openai', authType: 'api_key' },
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('"gpt-9"');
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('rejects a primary on a provider that is not enabled for the agent', async () => {
      const err = await svc
        .create('agent-1', 'tenant-1', {
          name: 'x',
          override_route: { model: 'gpt-4o', provider: 'mistral', authType: 'api_key' },
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
    });

    it('rejects an unresolvable fallback with a 400', async () => {
      const err = await svc
        .create('agent-1', 'tenant-1', {
          name: 'x',
          override_route: { model: 'gpt-4o' },
          fallback_routes: [{ model: 'nope' }],
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('"nope"');
    });

    it('rejects more than 5 fallbacks', async () => {
      const err = await svc
        .create('agent-1', 'tenant-1', {
          name: 'x',
          fallback_routes: Array.from({ length: 6 }, () => ({ model: 'gpt-4o' })),
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('at most 5 fallbacks');
    });

    it('stores a sent key label with the key spelling', async () => {
      await svc.create('agent-1', 'tenant-1', {
        name: 'x',
        override_route: { model: 'gpt-4o', keyLabel: 'work' },
      });
      const inserted = repo.insert.mock.calls[0][0] as VirtualModel;
      expect(inserted.override_route).toEqual({ ...route('openai', 'gpt-4o'), keyLabel: 'Work' });
      expect(providerKeys.getProviderKeys).toHaveBeenCalledWith(
        'tenant-1',
        'openai',
        'api_key',
        'agent-1',
      );
    });

    it('rejects a key label that does not exist for the provider with a 400', async () => {
      const err = await svc
        .create('agent-1', 'tenant-1', {
          name: 'x',
          override_route: { model: 'gpt-4o', keyLabel: 'Personal' },
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('Provider key "Personal" is not connected');
    });

    it('prefers the exact key label and refuses an ambiguous case-insensitive one', async () => {
      providerKeys.getProviderKeys.mockResolvedValue([
        { id: 'k1', label: 'Work', priority: 0, apiKey: 'x', region: null },
        { id: 'k2', label: 'work', priority: 1, apiKey: 'y', region: null },
      ]);
      await svc.create('agent-1', 'tenant-1', {
        name: 'exact',
        override_route: { model: 'gpt-4o', keyLabel: 'work' },
      });
      const inserted = repo.insert.mock.calls[0][0] as VirtualModel;
      expect(inserted.override_route?.keyLabel).toBe('work');

      const err = await svc
        .create('agent-1', 'tenant-1', {
          name: 'ambiguous',
          override_route: { model: 'gpt-4o', keyLabel: 'WORK' },
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('matches several keys');
    });

    it('keeps a fallback key label sent without provider or auth type', async () => {
      await svc.create('agent-1', 'tenant-1', {
        name: 'x',
        override_route: { model: 'gpt-4o' },
        fallback_routes: [{ model: 'gpt-4o-mini', keyLabel: 'work' }, { model: 'deepseek-chat' }],
      });
      const inserted = repo.insert.mock.calls[0][0] as VirtualModel;
      expect(inserted.fallback_routes).toEqual([
        { ...route('openai', 'gpt-4o-mini'), keyLabel: 'Work' },
        route('deepseek', 'deepseek-chat'),
      ]);
    });

    it('validates fallback key labels when structured routes are sent', async () => {
      const err = await svc
        .create('agent-1', 'tenant-1', {
          name: 'x',
          override_route: { model: 'gpt-4o' },
          fallback_routes: [
            { model: 'gpt-4o-mini', provider: 'openai', authType: 'api_key', keyLabel: 'Ghost' },
          ],
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
    });

    it('rejects stream mode without a stream-capable route', async () => {
      await expect(
        svc.create('agent-1', 'tenant-1', { name: 'x', response_mode: 'stream' }),
      ).rejects.toThrow('Cannot enable streaming for virtual model "x"');
    });

    it('rejects an invalid response mode, output modality or continue_on_default', async () => {
      await expect(
        svc.create('agent-1', 'tenant-1', { name: 'x', response_mode: 'bogus' as never }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.create('agent-1', 'tenant-1', { name: 'x', output_modality: 'image' as never }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.create('agent-1', 'tenant-1', { name: 'x', continue_on_default: 'yes' as never }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    beforeEach(() => repo.findOne.mockResolvedValue(row()));

    it('404s an id outside the agent', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(svc.update('agent-1', 'tenant-1', 'nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'nope', agent_id: 'agent-1' } });
    });

    it('renames, toggles continue_on_default and invalidates', async () => {
      repo.find.mockResolvedValue([row()]);
      const view = await svc.update('agent-1', 'tenant-1', 'vm-1', {
        name: 'DeepSeek/Flash',
        continue_on_default: true,
      });
      expect(view).toMatchObject({ name: 'DeepSeek/Flash', continue_on_default: true });
      expect(repo.save).toHaveBeenCalled();
      expect(routingCache.invalidateAgent).toHaveBeenCalledWith('agent-1');
    });

    it('rejects a sibling name with a 409', async () => {
      repo.find.mockResolvedValue([row(), row({ id: 'vm-2', name: 'Other' })]);
      await expect(
        svc.update('agent-1', 'tenant-1', 'vm-1', { name: 'other' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a unique-index race on save to a 409', async () => {
      repo.save.mockRejectedValue({ code: '23505', constraint: 'IDX_virtual_models_agent_name' });
      await expect(
        svc.update('agent-1', 'tenant-1', 'vm-1', { name: 'fresh' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a reserved name', async () => {
      await expect(
        svc.update('agent-1', 'tenant-1', 'vm-1', { name: 'auto' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('setEnabled / setResponseMode', () => {
    beforeEach(() => repo.findOne.mockResolvedValue(row()));

    it('toggles enabled', async () => {
      const view = await svc.setEnabled('agent-1', 'tenant-1', 'vm-1', false);
      expect(view.enabled).toBe(false);
      expect(routingCache.invalidateAgent).toHaveBeenCalledWith('agent-1');
    });

    it('rejects a non-boolean enabled', async () => {
      await expect(
        svc.setEnabled('agent-1', 'tenant-1', 'vm-1', 'no' as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('guards stream mode on an empty chain', async () => {
      await expect(svc.setResponseMode('agent-1', 'tenant-1', 'vm-1', 'stream')).rejects.toThrow(
        'Cannot enable streaming',
      );
    });

    it('accepts stream mode with a stream-capable primary', async () => {
      repo.findOne.mockResolvedValue(row({ override_route: route('openai', 'gpt-4o') }));
      const view = await svc.setResponseMode('agent-1', 'tenant-1', 'vm-1', 'stream');
      expect(view.response_mode).toBe('stream');
    });
  });

  describe('override and fallbacks', () => {
    beforeEach(() => repo.findOne.mockResolvedValue(row()));

    it('sets a resolved primary', async () => {
      const view = await svc.setOverride('agent-1', 'tenant-1', 'vm-1', {
        model: 'claude-opus-4-6',
      });
      expect(view.override_route).toEqual(route('anthropic', 'claude-opus-4-6'));
      expect(view.context_length).toBe(200000);
    });

    it('rejects an unresolvable primary instead of storing it as given', async () => {
      await expect(
        svc.setOverride('agent-1', 'tenant-1', 'vm-1', {
          model: 'ghost',
          provider: 'openai',
          authType: 'api_key',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects an empty primary model', async () => {
      await expect(svc.setOverride('agent-1', 'tenant-1', 'vm-1', { model: '  ' })).rejects.toThrow(
        'A primary model is required',
      );
    });

    it('clears the primary together with the fallbacks', async () => {
      repo.findOne.mockResolvedValue(
        row({ override_route: route('openai', 'gpt-4o'), fallback_routes: [route('a', 'b')] }),
      );
      await svc.clearOverride('agent-1', 'vm-1');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ override_route: null, fallback_routes: null }),
      );
      expect(routingCache.invalidateAgent).toHaveBeenCalledWith('agent-1');
    });

    it('sets fallbacks from aligned structured routes', async () => {
      const out = await svc.setFallbacks(
        'agent-1',
        'tenant-1',
        'vm-1',
        ['gpt-4o-mini'],
        [{ ...route('openai', 'gpt-4o-mini'), keyLabel: 'WORK' }],
      );
      expect(out).toEqual([{ ...route('openai', 'gpt-4o-mini'), keyLabel: 'Work' }]);
    });

    it('re-validates previously stored fallbacks', async () => {
      repo.findOne.mockResolvedValue(row({ fallback_routes: [route('gone', 'old-model')] }));
      await expect(
        svc.setFallbacks('agent-1', 'tenant-1', 'vm-1', ['old-model']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns [] and stores null for an empty list', async () => {
      expect(await svc.setFallbacks('agent-1', 'tenant-1', 'vm-1', [])).toEqual([]);
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ fallback_routes: null }));
    });

    it('rejects more than 5 fallbacks', async () => {
      await expect(
        svc.setFallbacks('agent-1', 'tenant-1', 'vm-1', Array(6).fill('gpt-4o')),
      ).rejects.toThrow('at most 5 fallbacks');
    });

    it('clears fallbacks', async () => {
      await svc.clearFallbacks('agent-1', 'vm-1');
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ fallback_routes: null }));
    });
  });

  describe('reorder', () => {
    beforeEach(() => repo.find.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' })]));

    it('assigns sort_order by position', async () => {
      await svc.reorder('agent-1', ['b', 'a']);
      const saved = repo.save.mock.calls[0][0] as VirtualModel[];
      expect(Object.fromEntries(saved.map((r) => [r.id, r.sort_order]))).toEqual({ a: 1, b: 0 });
      expect(routingCache.invalidateAgent).toHaveBeenCalledWith('agent-1');
    });

    it.each([[['a']], [['a', 'a']], [['a', 'c']]])('rejects %j', async (ids) => {
      await expect(svc.reorder('agent-1', ids)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-array', async () => {
      await expect(svc.reorder('agent-1', 'a' as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('delete', () => {
    it('deletes the row and its virtual:<id> model params in one transaction', async () => {
      repo.findOne.mockResolvedValue(row());
      await svc.delete('agent-1', 'vm-1');
      expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(repo.manager.delete).toHaveBeenCalledWith(AgentModelParams, {
        agent_id: 'agent-1',
        scope_key: 'virtual:vm-1',
      });
      expect(repo.manager.delete).toHaveBeenCalledWith(VirtualModel, {
        id: 'vm-1',
        agent_id: 'agent-1',
      });
      expect(routingCache.invalidateAgent).toHaveBeenCalledWith('agent-1');
    });

    it('404s an id outside the agent', async () => {
      await expect(svc.delete('agent-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.manager.transaction).not.toHaveBeenCalled();
    });
  });
});
