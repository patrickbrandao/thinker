import type { ModelRoute } from 'thinker-shared';
import { FindOperator, type Repository } from 'typeorm';
import { ProviderService } from '../provider.service';
import type { TenantProvider } from '../../../entities/tenant-provider.entity';
import type { TierAssignment } from '../../../entities/tier-assignment.entity';
import type { SpecificityAssignment } from '../../../entities/specificity-assignment.entity';
import type { Agent } from '../../../entities/agent.entity';
import type { HeaderTier } from '../../../entities/header-tier.entity';
import type { AgentEnabledProvider } from '../../../entities/agent-enabled-provider.entity';
import type { VirtualModel } from '../../../entities/virtual-model.entity';
import type { RoutingCacheService } from '../routing-cache.service';
import type { ModelPricingCacheService } from '../../../model-prices/model-pricing-cache.service';

/**
 * ADR 0004: a provider used by a virtual model's own chain (override or any
 * fallback, enabled or disabled row) cannot be disconnected or removed, the
 * same way a tier route blocks it.
 */

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';

const openai = (model = 'gpt-4o'): ModelRoute => ({
  provider: 'openai',
  authType: 'api_key',
  model,
});
const anthropic = (model = 'claude'): ModelRoute => ({
  provider: 'anthropic',
  authType: 'api_key',
  model,
});

function providerRow(over: Partial<TenantProvider> = {}): TenantProvider {
  return {
    id: 'p-openai',
    tenant_id: TENANT,
    provider: 'openai',
    auth_type: 'api_key',
    label: 'Default',
    priority: 0,
    is_active: true,
    cached_models: [],
    ...over,
  } as TenantProvider;
}

function vm(over: Partial<VirtualModel>): VirtualModel {
  return {
    id: 'vm-1',
    tenant_id: TENANT,
    agent_id: 'agent-a',
    name: 'deepseek/flash',
    sort_order: 0,
    enabled: true,
    override_route: null,
    fallback_routes: null,
    continue_on_default: false,
    ...over,
  } as VirtualModel;
}

/** Applies the `where` of a find() to in-memory rows (equality and In()). */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      const values = expected.value as unknown[];
      return values.includes(row[key]);
    }
    return row[key] === expected;
  });
}

function memoryRepo<T extends object>(rows: T[]) {
  return {
    rows,
    find: jest.fn(async (opts?: { where?: Record<string, unknown> }) =>
      rows.filter((r) => matchesWhere(r as Record<string, unknown>, opts?.where)),
    ),
    findOne: jest.fn(async (opts?: { where?: Record<string, unknown> }) => {
      return rows.find((r) => matchesWhere(r as Record<string, unknown>, opts?.where)) ?? null;
    }),
    save: jest.fn(async (input: T | T[]) => input),
    remove: jest.fn(async (input: T) => input),
    delete: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
    manager: { getRepository: () => ({ delete: jest.fn(async () => undefined) }) },
  };
}

function agentRepoFor(agents: Array<{ id: string; name: string; tenant_id: string }>) {
  let tenantFilter: string | undefined;
  interface Qb {
    where: jest.Mock;
    andWhere: jest.Mock;
    select: jest.Mock;
    getRawMany: jest.Mock;
  }
  const qb: Qb = {
    where: jest.fn((_sql: string, params: { tenantId: string }): Qb => {
      tenantFilter = params.tenantId;
      return qb;
    }),
    andWhere: jest.fn((): Qb => qb),
    select: jest.fn((): Qb => qb),
    getRawMany: jest.fn(async () =>
      agents
        .filter((a) => a.tenant_id === tenantFilter)
        .map((a) => ({ id: a.id, name: a.name, display_name: null })),
    ),
  };
  return { createQueryBuilder: jest.fn(() => qb) };
}

interface Setup {
  providers?: TenantProvider[];
  virtualModels?: VirtualModel[];
  tiers?: Partial<TierAssignment>[];
  enabled?: Array<{ agent_id: string; tenant_provider_id: string }>;
}

function build(setup: Setup = {}) {
  const providers = setup.providers ?? [providerRow()];
  const providerRepo = memoryRepo<TenantProvider>(providers);
  const tierRepo = memoryRepo<Partial<TierAssignment>>(setup.tiers ?? []);
  const specRepo = memoryRepo<Partial<SpecificityAssignment>>([]);
  const headerRepo = memoryRepo<Partial<HeaderTier>>([]);
  const vmRepo = memoryRepo<VirtualModel>(setup.virtualModels ?? []);
  const agents = [
    { id: 'agent-a', name: 'a', tenant_id: TENANT },
    { id: 'agent-b', name: 'b', tenant_id: TENANT },
    { id: 'agent-x', name: 'x', tenant_id: OTHER_TENANT },
  ];
  const enabled =
    setup.enabled ??
    agents.flatMap((a) => providers.map((p) => ({ agent_id: a.id, tenant_provider_id: p.id })));
  const enabledRepo = memoryRepo<{ agent_id: string; tenant_provider_id: string }>(enabled);
  const routingCache = {
    getProviders: jest.fn().mockReturnValue(null),
    setProviders: jest.fn(),
    invalidateAgent: jest.fn(),
    invalidateTenant: jest.fn(),
  };
  const svc = new ProviderService(
    providerRepo as unknown as Repository<TenantProvider>,
    tierRepo as unknown as Repository<TierAssignment>,
    specRepo as unknown as Repository<SpecificityAssignment>,
    agentRepoFor(agents) as unknown as Repository<Agent>,
    headerRepo as unknown as Repository<HeaderTier>,
    { getByModel: jest.fn().mockReturnValue(undefined) } as unknown as ModelPricingCacheService,
    routingCache as unknown as RoutingCacheService,
    enabledRepo as unknown as Repository<AgentEnabledProvider>,
    vmRepo as unknown as Repository<VirtualModel>,
  );
  return { svc, providerRepo, vmRepo, enabledRepo, routingCache };
}

describe('ProviderService — virtual model route guards', () => {
  it('blocks disconnect when an active virtual model overrides to the provider', async () => {
    const { svc, providerRepo } = build({
      virtualModels: [vm({ override_route: openai() })],
    });

    await expect(svc.removeProvider(null, TENANT, 'openai')).rejects.toThrow(
      'Cannot disconnect provider while its models are assigned to routing. ' +
        'Update routing first (agent "a", virtual model "deepseek/flash", primary: gpt-4o).',
    );
    expect(providerRepo.save).not.toHaveBeenCalled();
  });

  it('blocks disconnect when a disabled virtual model still routes to the provider', async () => {
    const { svc, providerRepo } = build({
      virtualModels: [vm({ enabled: false, override_route: openai() })],
    });

    await expect(svc.removeProvider(null, TENANT, 'openai')).rejects.toThrow(/virtual model/);
    expect(providerRepo.save).not.toHaveBeenCalled();
  });

  it('blocks disconnect when the provider only appears in a virtual fallback', async () => {
    const { svc } = build({
      virtualModels: [
        vm({
          override_route: anthropic(),
          fallback_routes: [anthropic('c2'), openai('gpt-4o-mini')],
        }),
      ],
    });

    await expect(svc.removeProvider(null, TENANT, 'openai')).rejects.toThrow(
      /virtual model "deepseek\/flash", fallback 2: gpt-4o-mini/,
    );
  });

  it('blocks disconnect when a virtual of another agent in the same tenant uses it', async () => {
    const { svc } = build({
      virtualModels: [vm({ agent_id: 'agent-b', name: 'b-model', override_route: openai() })],
    });

    await expect(svc.removeProvider('agent-a', TENANT, 'openai')).rejects.toThrow(
      /agent "b", virtual model "b-model"/,
    );
  });

  it('ignores virtual models of another tenant', async () => {
    const { svc, providerRepo, vmRepo } = build({
      virtualModels: [
        vm({ tenant_id: OTHER_TENANT, agent_id: 'agent-x', override_route: openai() }),
      ],
    });

    await expect(svc.removeProvider(null, TENANT, 'openai')).resolves.toEqual({
      notifications: [],
    });
    expect(providerRepo.save).toHaveBeenCalled();
    // The query itself is tenant-scoped, not just filtered by agent ids.
    expect(vmRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT }) }),
    );
  });

  it('does not count a virtual that only continues on Default', async () => {
    const { svc, providerRepo } = build({
      virtualModels: [vm({ override_route: anthropic(), continue_on_default: true })],
    });

    await expect(svc.removeProvider(null, TENANT, 'openai')).resolves.toEqual({
      notifications: [],
    });
    expect(providerRepo.save).toHaveBeenCalled();
  });

  it('follows the tier rule: a virtual on an agent with the provider disabled does not block', async () => {
    const { svc, providerRepo } = build({
      virtualModels: [vm({ override_route: openai() })],
      enabled: [{ agent_id: 'agent-b', tenant_provider_id: 'p-openai' }],
    });

    await expect(svc.removeProvider(null, TENANT, 'openai')).resolves.toEqual({
      notifications: [],
    });
    expect(providerRepo.save).toHaveBeenCalled();
  });

  it('still disconnects a provider nobody routes to (regression)', async () => {
    const { svc, providerRepo, enabledRepo } = build({
      virtualModels: [vm({ override_route: anthropic(), fallback_routes: [anthropic('c2')] })],
    });

    await expect(svc.removeProvider(null, TENANT, 'openai')).resolves.toEqual({
      notifications: [],
    });
    expect(providerRepo.save).toHaveBeenCalled();
    expect(enabledRepo.delete).toHaveBeenCalled();
  });

  it('blocks removing a labeled key pinned by a virtual model', async () => {
    const work = providerRow({ id: 'p-work', label: 'work', priority: 1 });
    const { svc, providerRepo } = build({
      providers: [providerRow(), work],
      virtualModels: [vm({ override_route: { ...openai(), keyLabel: 'work' } })],
    });

    await expect(svc.removeProvider(null, TENANT, 'openai', 'api_key', 'work')).rejects.toThrow(
      /virtual model "deepseek\/flash"/,
    );
    expect(providerRepo.remove).not.toHaveBeenCalled();
  });

  it('blocks deactivating all providers while a virtual model routes to one', async () => {
    const { svc, providerRepo } = build({
      virtualModels: [vm({ fallback_routes: [openai()] })],
    });

    await expect(svc.deactivateAllProviders('agent-a', TENANT)).rejects.toThrow(/virtual model/);
    expect(providerRepo.update).not.toHaveBeenCalled();
  });

  it('keeps the tier message when a tier is the first match', async () => {
    const { svc } = build({
      tiers: [
        { agent_id: 'agent-a', tier: 'default', override_route: openai(), fallback_routes: null },
      ],
      virtualModels: [vm({ override_route: openai() })],
    });

    await expect(svc.removeProvider(null, TENANT, 'openai')).rejects.toThrow(
      /agent "a", tier default, primary: gpt-4o/,
    );
  });
});

describe('ProviderService — key relabels reach virtual models', () => {
  const pin = (label: string, model: string): ModelRoute => ({ ...openai(model), keyLabel: label });
  const keys = () => [providerRow(), providerRow({ id: 'p-work', label: 'Work', priority: 1 })];

  it('renameKey rewrites override and fallback pins (enabled or not) and invalidates the agents', async () => {
    const { svc, vmRepo, routingCache } = build({
      providers: keys(),
      virtualModels: [
        vm({
          id: 'vm-a',
          enabled: false,
          override_route: pin('Work', 'gpt-4o'),
          fallback_routes: [pin('Default', 'gpt-4o-mini'), pin('work', 'o3')],
        }),
        vm({ id: 'vm-b', agent_id: 'agent-b', override_route: anthropic() }),
        // Same label string on another tenant: untouched.
        vm({
          id: 'vm-x',
          tenant_id: OTHER_TENANT,
          agent_id: 'agent-x',
          override_route: pin('Work', 'gpt-4o'),
        }),
      ],
    });

    await svc.renameKey(null, TENANT, 'openai', 'api_key', 'Work', 'Job');

    const [a, b, x] = vmRepo.rows;
    expect(a.override_route?.keyLabel).toBe('Job');
    expect(a.fallback_routes?.map((r) => r.keyLabel)).toEqual(['Default', 'Job']);
    expect(b.override_route).toEqual(anthropic());
    expect(x.override_route?.keyLabel).toBe('Work');
    expect(vmRepo.save).toHaveBeenCalledWith([a]);
    expect(routingCache.invalidateAgent).toHaveBeenCalledWith('agent-a');
    expect(routingCache.invalidateAgent).not.toHaveBeenCalledWith('agent-x');
  });

  it('renameKey leaves pins of another provider with the same label alone', async () => {
    const { svc, vmRepo } = build({
      providers: keys(),
      virtualModels: [vm({ override_route: { ...anthropic(), keyLabel: 'Work' } })],
    });

    await svc.renameKey(null, TENANT, 'openai', 'api_key', 'Work', 'Job');

    expect(vmRepo.rows[0].override_route?.keyLabel).toBe('Work');
    expect(vmRepo.save).not.toHaveBeenCalled();
  });

  it('deleting an inactive key clears its pin on virtual models', async () => {
    const { svc, vmRepo, providerRepo } = build({
      providers: [
        providerRow(),
        providerRow({ id: 'p-work', label: 'Work', priority: 1, is_active: false }),
      ],
      virtualModels: [
        vm({ override_route: pin('Work', 'gpt-4o'), fallback_routes: [pin('Work', 'o3')] }),
      ],
    });

    await svc.removeProvider(null, TENANT, 'openai', 'api_key', 'Work');

    expect(providerRepo.remove).toHaveBeenCalled();
    expect(vmRepo.rows[0].override_route?.keyLabel).toBeNull();
    expect(vmRepo.rows[0].fallback_routes?.[0].keyLabel).toBeNull();
  });
});
