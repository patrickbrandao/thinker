import type { ModelRoute } from 'thinker-shared';
import type { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import {
  buildVirtualModelChain,
  chainContextLength,
  chainContextWindow,
  computeShadows,
  snapshotOverrideAvailable,
  snapshotRouteState,
  tierChainRoutes,
  virtualModelContextLength,
} from '../virtual-model-chain';

const route = (
  provider: string,
  model: string,
  authType: ModelRoute['authType'] = 'api_key',
  keyLabel?: string,
): ModelRoute =>
  keyLabel ? { provider, authType, model, keyLabel } : { provider, authType, model };

const discovered = (
  id: string,
  provider: string,
  contextWindow: number,
  extra: Partial<DiscoveredModel> = {},
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
    authType: 'api_key',
    ...extra,
  }) as DiscoveredModel;

const vm = (overrides: Partial<Parameters<typeof buildVirtualModelChain>[0]> = {}) => ({
  id: 'vm-1',
  override_route: route('openai', 'gpt-4o'),
  fallback_routes: [route('anthropic', 'claude-opus-4-6')],
  continue_on_default: false,
  ...overrides,
});

describe('buildVirtualModelChain', () => {
  const defaultTier = (overrides: Partial<Parameters<typeof tierChainRoutes>[0]> = {}) => ({
    override_route: route('deepseek', 'deepseek-chat'),
    auto_assigned_route: null,
    fallback_routes: null,
    ...overrides,
  });

  it('lists the primary then the fallbacks under the virtual scope', async () => {
    expect(await buildVirtualModelChain(vm(), null)).toEqual([
      { route: route('openai', 'gpt-4o'), paramsScope: 'virtual:vm-1', fromDefault: false },
      {
        route: route('anthropic', 'claude-opus-4-6'),
        paramsScope: 'virtual:vm-1',
        fromDefault: false,
      },
    ]);
  });

  it('ignores the Default tier when continue_on_default is off', async () => {
    expect(await buildVirtualModelChain(vm(), defaultTier())).toHaveLength(2);
  });

  it('appends the Default chain under tier:default and drops repeated routes', async () => {
    const chain = await buildVirtualModelChain(
      vm({ continue_on_default: true }),
      defaultTier({
        fallback_routes: [route('openai', 'gpt-4o'), route('openai', 'gpt-4o', 'api_key', 'Work')],
      }),
    );
    expect(chain.map((e) => [e.route.model, e.route.keyLabel ?? null, e.paramsScope])).toEqual([
      ['gpt-4o', null, 'virtual:vm-1'],
      ['claude-opus-4-6', null, 'virtual:vm-1'],
      ['deepseek-chat', null, 'tier:default'],
      // Same model on another key is another route.
      ['gpt-4o', 'Work', 'tier:default'],
    ]);
    expect(chain.filter((e) => e.fromDefault)).toHaveLength(2);
  });

  it('keeps the legacy auto-assigned route out while the Default override is available', async () => {
    const chain = await buildVirtualModelChain(
      vm({ continue_on_default: true }),
      defaultTier({ auto_assigned_route: route('legacy', 'old-model') }),
    );
    expect(chain.map((e) => e.route.model)).toEqual(['gpt-4o', 'claude-opus-4-6', 'deepseek-chat']);
  });

  it('reaches the auto-assigned route when the Default override is unavailable', async () => {
    const isDefaultOverrideAvailable = jest.fn().mockResolvedValue(false);
    const chain = await buildVirtualModelChain(
      vm({ continue_on_default: true }),
      defaultTier({
        auto_assigned_route: route('legacy', 'old-model'),
        fallback_routes: [route('openai', 'gpt-4o-mini')],
      }),
      { isDefaultOverrideAvailable },
    );
    expect(isDefaultOverrideAvailable).toHaveBeenCalledWith(route('deepseek', 'deepseek-chat'));
    expect(chain.filter((e) => e.fromDefault).map((e) => e.route.model)).toEqual([
      'gpt-4o-mini',
      'old-model',
    ]);
  });

  it('normalizes each route before deduplicating', async () => {
    // Request-time key label: the default key of openai is "Main".
    const normalize = jest.fn((r: ModelRoute) =>
      r.provider === 'openai' && !r.keyLabel ? { ...r, keyLabel: 'Main' } : r,
    );
    const chain = await buildVirtualModelChain(
      vm({ continue_on_default: true }),
      defaultTier({ fallback_routes: [route('openai', 'gpt-4o', 'api_key', 'Main')] }),
      { normalize },
    );
    expect(chain.map((e) => [e.route.model, e.route.keyLabel ?? null])).toEqual([
      ['gpt-4o', 'Main'],
      ['claude-opus-4-6', null],
      ['deepseek-chat', null],
    ]);
    expect(normalize).toHaveBeenCalledWith(route('openai', 'gpt-4o'), {
      paramsScope: 'virtual:vm-1',
      fromDefault: false,
    });
  });

  it('tolerates an empty virtual chain and a missing Default tier', async () => {
    expect(
      await buildVirtualModelChain(
        vm({ override_route: null, fallback_routes: null, continue_on_default: true }),
        null,
      ),
    ).toEqual([]);
  });
});

describe('tierChainRoutes', () => {
  const tier = {
    override_route: route('a', 'm1'),
    auto_assigned_route: route('a', 'auto'),
    fallback_routes: [route('a', 'm2')],
  };

  it('uses only the override and its fallbacks while the override is available', () => {
    expect(tierChainRoutes(tier, true).map((r) => r.model)).toEqual(['m1', 'm2']);
  });

  it('walks the fallbacks, then the auto-assigned route, when the override is unavailable', () => {
    expect(tierChainRoutes(tier, false).map((r) => r.model)).toEqual(['m2', 'auto']);
  });

  it('leads with the auto-assigned route when there is no override', () => {
    expect(tierChainRoutes({ ...tier, override_route: null }, true).map((r) => r.model)).toEqual([
      'auto',
      'm2',
    ]);
  });
});

describe('computeShadows', () => {
  const catalog = [
    discovered('gpt-5.5', 'openai', 0),
    discovered('gpt-5.5', 'openai', 0, { authType: 'subscription' }),
    discovered('claude-sonnet-4-5', 'anthropic', 0),
    discovered(
      'custom:11111111-1111-1111-1111-111111111111/llama3',
      'custom:11111111-1111-1111-1111-111111111111',
      0,
    ),
    discovered(
      'custom:22222222-2222-2222-2222-222222222222/qwen',
      'custom:22222222-2222-2222-2222-222222222222',
      0,
      {
        providerAlias: 'lab',
      },
    ),
  ];

  it('matches public ids ignoring case', () => {
    expect(computeShadows('OpenAI/GPT-5.5', catalog)).toEqual(['openai/gpt-5.5']);
    expect(computeShadows('openai/gpt-5.5-subscription', catalog)).toEqual([
      'openai/gpt-5.5-subscription',
    ]);
  });

  it('matches native ids', () => {
    expect(computeShadows('claude-sonnet-4-5', catalog)).toEqual(['claude-sonnet-4-5']);
    expect(computeShadows('gpt-5.5', catalog)).toEqual(['gpt-5.5']);
  });

  it('does not match another spelling of the same model', () => {
    expect(computeShadows('anthropic/claude-sonnet', catalog)).toEqual([]);
  });

  it('lists the custom:<uuid> id of a provider without alias, which is its public id', () => {
    expect(computeShadows('custom:11111111-1111-1111-1111-111111111111/llama3', catalog)).toEqual([
      'custom:11111111-1111-1111-1111-111111111111/llama3',
    ]);
  });

  it('lists the alias id but not the internal id of a provider with an alias', () => {
    expect(computeShadows('lab/qwen', catalog)).toEqual(['lab/qwen']);
    expect(computeShadows('custom:22222222-2222-2222-2222-222222222222/qwen', catalog)).toEqual([]);
  });
});

describe('snapshotRouteState', () => {
  const catalog = [
    discovered('gpt-4o', 'openai', 128000),
    discovered('gemini-2.5-pro', 'gemini', 0),
  ];

  it('is available with the window when the connection lists the model', () => {
    expect(snapshotRouteState(route('openai', 'gpt-4o'), catalog)).toEqual({
      state: 'available',
      contextWindow: 128000,
    });
  });

  it('reports an unknown window as null', () => {
    expect(snapshotRouteState(route('gemini', 'gemini-2.5-pro'), catalog)).toEqual({
      state: 'available',
      contextWindow: null,
    });
  });

  it('is unavailable when the connection lists other models only', () => {
    expect(snapshotRouteState(route('openai', 'gpt-3.5'), catalog)).toEqual({
      state: 'unavailable',
    });
  });

  it('honors the auth type', () => {
    expect(snapshotRouteState(route('openai', 'gpt-4o', 'subscription'), catalog)).toEqual({
      state: 'unknown',
    });
  });

  it('is unknown when the connection has no models in the snapshot', () => {
    expect(snapshotRouteState(route('mistral', 'mistral-large'), catalog)).toEqual({
      state: 'unknown',
    });
  });
});

describe('chainContextLength', () => {
  const catalog = [
    discovered('gpt-4o', 'openai', 128000),
    discovered('claude-opus-4-6', 'anthropic', 200000),
    discovered('mystery', 'deepseek', 0),
    // A model without stream support in the capability table would be
    // filtered in stream mode; see the stream test below.
  ];

  it('is the smallest window among available routes', () => {
    expect(
      chainContextLength(
        [route('anthropic', 'claude-opus-4-6'), route('openai', 'gpt-4o')],
        'buffered',
        catalog,
      ),
    ).toBe(128000);
  });

  it('skips unavailable routes', () => {
    expect(
      chainContextLength(
        [route('openai', 'gone'), route('anthropic', 'claude-opus-4-6')],
        'buffered',
        catalog,
      ),
    ).toBe(200000);
  });

  it('is null when a reachable route has an unknown window', () => {
    expect(
      chainContextLength(
        [route('anthropic', 'claude-opus-4-6'), route('deepseek', 'mystery')],
        'buffered',
        catalog,
      ),
    ).toBeNull();
  });

  it('is null when a route has unknown availability', () => {
    expect(
      chainContextLength(
        [route('anthropic', 'claude-opus-4-6'), route('mistral', 'mistral-large')],
        'buffered',
        catalog,
      ),
    ).toBeNull();
  });

  it('is null for an empty or fully unavailable chain', () => {
    expect(chainContextLength([], 'buffered', catalog)).toBeNull();
    expect(chainContextLength([route('openai', 'gone')], 'buffered', catalog)).toBeNull();
  });

  it('applies the response-mode filter before taking the minimum', () => {
    // Every model here is stream-capable, so stream mode keeps them all.
    expect(
      chainContextLength(
        [route('anthropic', 'claude-opus-4-6'), route('openai', 'gpt-4o')],
        'stream',
        catalog,
      ),
    ).toBe(128000);
  });
});

describe('chainContextWindow', () => {
  const catalog = [
    discovered('gpt-4o', 'openai', 128000),
    discovered('claude-opus-4-6', 'anthropic', 200000),
    discovered('mystery', 'deepseek', 0),
  ];

  it('keeps "no route left" apart from "window unknown"', () => {
    expect(chainContextWindow([], 'buffered', catalog)).toEqual({ kind: 'empty' });
    expect(chainContextWindow([route('openai', 'gone')], 'buffered', catalog)).toEqual({
      kind: 'empty',
    });
    expect(chainContextWindow([route('deepseek', 'mystery')], 'buffered', catalog)).toEqual({
      kind: 'unknown',
    });
    expect(chainContextWindow([route('mistral', 'm')], 'buffered', catalog)).toEqual({
      kind: 'unknown',
    });
    expect(
      chainContextWindow(
        [route('anthropic', 'claude-opus-4-6'), route('openai', 'gpt-4o')],
        'buffered',
        catalog,
      ),
    ).toEqual({ kind: 'known', value: 128000 });
  });
});

describe('snapshotOverrideAvailable', () => {
  const catalog = [discovered('gpt-4o', 'openai', 128000)];

  it('is false only when the connection lists models but not this one', () => {
    expect(snapshotOverrideAvailable(route('openai', 'gpt-4o'), catalog)).toBe(true);
    expect(snapshotOverrideAvailable(route('openai', 'gone'), catalog)).toBe(false);
    // Cold discovery: the snapshot cannot judge it, so it counts as reachable.
    expect(snapshotOverrideAvailable(route('mistral', 'm'), catalog)).toBe(true);
  });
});

describe('virtualModelContextLength', () => {
  const catalog = [
    discovered('gpt-4o', 'openai', 128000),
    discovered('claude-opus-4-6', 'anthropic', 200000),
    discovered('deepseek-chat', 'deepseek', 64000),
    discovered('mystery', 'mistral', 0),
  ];
  const virtual = (overrides: Partial<Parameters<typeof virtualModelContextLength>[0]> = {}) => ({
    ...vm(),
    response_mode: 'buffered' as const,
    ...overrides,
  });
  const defaultTier = {
    override_route: route('deepseek', 'deepseek-chat'),
    auto_assigned_route: null,
    fallback_routes: null,
  };

  it('uses only the virtual chain without continue_on_default', async () => {
    expect(await virtualModelContextLength(virtual(), defaultTier, catalog)).toBe(128000);
  });

  it('adds the Default chain with continue_on_default', async () => {
    expect(
      await virtualModelContextLength(virtual({ continue_on_default: true }), defaultTier, catalog),
    ).toBe(64000);
  });

  it('reaches a Default that only has the legacy auto-assigned route', async () => {
    expect(
      await virtualModelContextLength(
        virtual({ override_route: null, fallback_routes: null, continue_on_default: true }),
        {
          override_route: null,
          auto_assigned_route: route('deepseek', 'deepseek-chat'),
          fallback_routes: null,
        },
        catalog,
      ),
    ).toBe(64000);
  });

  it('is null when the chain is empty or a window is unknown', async () => {
    expect(
      await virtualModelContextLength(
        virtual({ override_route: null, fallback_routes: null }),
        null,
        catalog,
      ),
    ).toBeNull();
    expect(
      await virtualModelContextLength(
        virtual({ fallback_routes: [route('mistral', 'mystery')] }),
        null,
        catalog,
      ),
    ).toBeNull();
  });
});
