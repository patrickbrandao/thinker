import { combineRouteStatus, withDisabled, type ModelRoute } from 'thinker-shared';
import {
  chainRouteStatus,
  routeOutOfServiceReason,
  snapshotRouteState,
  type RouteSnapshot,
} from '../virtual-models/virtual-model-chain';
import { resolveFallbackRoutes } from '../routing-core/resolve-model-route';
import { servingFallbackRoutes } from '../routing-core/route-helpers';
import { diffModelIds } from '../../model-discovery/model-catalog-change';
import {
  DiscoveryRefreshService,
  MODEL_ERROR_REDISCOVERY_COOLDOWN_MS,
  discoveryIntervalMs,
} from '../../model-discovery/discovery-refresh.service';
import { RouteImpactService } from './route-impact.service';

const r = (provider: string, model: string, extra: Partial<ModelRoute> = {}): ModelRoute => ({
  provider,
  authType: 'api_key',
  model,
  ...extra,
});

const snapshot: RouteSnapshot = {
  catalog: [
    { id: 'gpt-5', provider: 'openai', authType: 'api_key' },
    { id: 'gpt-5-mini', provider: 'openai', authType: 'api_key' },
  ] as never,
  providers: [{ provider: 'openai', authType: 'api_key' }],
};

describe('route status', () => {
  it('combines the admin choice with the catalog', () => {
    expect(combineRouteStatus(false, null)).toEqual({ status: 'active', reason: null });
    expect(combineRouteStatus(false, 'model_missing').status).toBe('active_oos');
    expect(combineRouteStatus(true, null).status).toBe('disabled');
    expect(combineRouteStatus(true, 'provider_unavailable').status).toBe('disabled_oos');
  });

  it('stores the flag only when true', () => {
    expect(withDisabled(r('openai', 'gpt-5', { disabled: true }), false)).toEqual(
      r('openai', 'gpt-5'),
    );
    expect(withDisabled(r('openai', 'gpt-5'), true)).toEqual(
      r('openai', 'gpt-5', { disabled: true }),
    );
  });

  it('reads why a route is out of service', () => {
    expect(routeOutOfServiceReason(r('openai', 'gpt-5'), snapshot)).toBeNull();
    expect(routeOutOfServiceReason(r('openai', 'gpt-4o'), snapshot)).toBe('model_missing');
    expect(routeOutOfServiceReason(r('mistral', 'large'), snapshot)).toBe('provider_unavailable');
  });

  it('a disabled route never serves but keeps its catalog status', () => {
    const disabled = r('openai', 'gpt-5', { disabled: true });
    expect(snapshotRouteState(disabled, snapshot).state).toBe('unavailable');
    expect(
      chainRouteStatus(
        {
          override_route: disabled,
          fallback_routes: [r('openai', 'gpt-4o', { disabled: true }), r('openai', 'gpt-5-mini')],
        },
        snapshot,
      ),
    ).toEqual({
      override: { status: 'disabled', reason: null },
      fallbacks: [
        { status: 'disabled_oos', reason: 'model_missing' },
        { status: 'active', reason: null },
      ],
    });
  });

  it('serving fallbacks skip disabled routes', () => {
    const row = {
      override_route: null,
      fallback_routes: [r('openai', 'a', { disabled: true }), r('openai', 'b')],
    };
    expect(servingFallbackRoutes(row)).toEqual([r('openai', 'b')]);
    expect(
      servingFallbackRoutes({
        override_route: null,
        fallback_routes: [r('openai', 'a', { disabled: true })],
      }),
    ).toBeNull();
  });

  it('a re-sent chain keeps the stored disabled flag', () => {
    const stored = [r('openai', 'gpt-4o', { disabled: true })];
    const res = resolveFallbackRoutes(
      ['gpt-4o'],
      snapshot.catalog,
      [r('openai', 'gpt-4o')],
      stored,
    );
    expect(res).toEqual({ ok: true, routes: [r('openai', 'gpt-4o', { disabled: true })] });
  });
});

describe('catalog diff', () => {
  it('reports added and removed ids, nothing on a first or empty discovery', () => {
    expect(diffModelIds([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }])).toEqual({
      added: ['c'],
      removed: ['a'],
    });
    expect(diffModelIds(null, [{ id: 'a' }])).toEqual({ added: [], removed: [] });
    expect(diffModelIds([{ id: 'a' }], [])).toEqual({ added: [], removed: [] });
  });
});

describe('DiscoveryRefreshService', () => {
  it('reads the interval from the environment', () => {
    expect(discoveryIntervalMs({})).toBe(6 * 3_600_000);
    expect(discoveryIntervalMs({ THINKER_DISCOVERY_INTERVAL_HOURS: '0' })).toBe(0);
    expect(discoveryIntervalMs({ THINKER_DISCOVERY_INTERVAL_HOURS: '1' })).toBe(3_600_000);
  });

  it('rediscovers a connection after a model error at most once per cooldown', async () => {
    const provider = { id: 'c1', provider: 'openai', tenant_id: 't1' };
    const repo = { findOne: jest.fn().mockResolvedValue(provider) };
    const discovery = { discoverModels: jest.fn().mockResolvedValue([]) };
    let clock = 1_000_000;
    const svc = new (class extends DiscoveryRefreshService {
      protected now() {
        return clock;
      }
    })(repo as never, discovery as never);
    const signal = {
      kind: 'attempt' as const,
      tenantId: 't1',
      agentId: 'a1',
      agentName: 'h',
      tenantProviderId: 'c1',
      provider: 'openai',
      keyLabel: null,
      model: 'gpt-4o',
      ok: false,
      httpStatus: 404,
      errorCode: null,
      errorMessage: 'The model `gpt-4o` does not exist',
    };
    await svc.onAttempt(signal);
    await svc.onAttempt(signal);
    expect(discovery.discoverModels).toHaveBeenCalledTimes(1);
    clock += MODEL_ERROR_REDISCOVERY_COOLDOWN_MS;
    await svc.onAttempt(signal);
    expect(discovery.discoverModels).toHaveBeenCalledTimes(2);
    await svc.onAttempt({ ...signal, httpStatus: 500, errorMessage: 'upstream overloaded' });
    expect(discovery.discoverModels).toHaveBeenCalledTimes(2);
  });
});

describe('RouteImpactService', () => {
  const change = {
    connection: {
      id: 'c1',
      tenant_id: 't1',
      provider: 'openai',
      auth_type: 'api_key',
      label: null,
    },
    added: [],
    removed: ['gpt-4o'],
  };

  it('lists the harnesses and chains that use a removed model', async () => {
    const vm = {
      agent_id: 'a1',
      name: 'smart',
      enabled: true,
      continue_on_default: false,
      response_mode: 'buffered',
      override_route: r('openai', 'gpt-4o'),
      fallback_routes: [r('openai', 'gpt-5-mini')],
    };
    const tier = {
      agent_id: 'a1',
      tier: 'default',
      override_route: r('anthropic', 'gpt-4o'),
      fallback_routes: [r('openai', 'gpt-4o', { disabled: true })],
    };
    const svc = new RouteImpactService(
      { find: jest.fn().mockResolvedValue([{ id: 'a1', name: 'claude-code' }]) } as never,
      { find: jest.fn().mockResolvedValue([vm]) } as never,
      { find: jest.fn().mockResolvedValue([tier]) } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { snapshot: jest.fn().mockResolvedValue(snapshot) } as never,
    );
    const out = await svc.affected(change, ['gpt-4o'], true);
    expect(out.get('gpt-4o')).toEqual([
      expect.objectContaining({
        harness: 'claude-code',
        chain: 'virtual_model',
        name: 'smart',
        position: 'primary',
        disabled: false,
        chain_routable: true,
      }),
      expect.objectContaining({
        chain: 'tier',
        name: 'default',
        position: 'fallback 1',
        disabled: true,
      }),
    ]);
  });
});
