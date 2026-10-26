import type { ModelRoute } from 'thinker-shared';
import type { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import {
  buildVirtualModelChain,
  chainContextLength,
  computeShadows,
  snapshotRouteState,
  tierChainRoutes,
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
  it('lists the primary then the fallbacks under the virtual scope', () => {
    expect(buildVirtualModelChain(vm(), null)).toEqual([
      { route: route('openai', 'gpt-4o'), paramsScope: 'virtual:vm-1', fromDefault: false },
      {
        route: route('anthropic', 'claude-opus-4-6'),
        paramsScope: 'virtual:vm-1',
        fromDefault: false,
      },
    ]);
  });

  it('ignores the Default tier when continue_on_default is off', () => {
    const chain = buildVirtualModelChain(vm(), {
      override_route: route('deepseek', 'deepseek-chat'),
      auto_assigned_route: null,
      fallback_routes: null,
    });
    expect(chain).toHaveLength(2);
  });

  it('appends the Default chain under tier:default and drops repeated routes', () => {
    const chain = buildVirtualModelChain(vm({ continue_on_default: true }), {
      override_route: route('deepseek', 'deepseek-chat'),
      auto_assigned_route: null,
      fallback_routes: [route('openai', 'gpt-4o'), route('openai', 'gpt-4o', 'api_key', 'Work')],
    });
    expect(chain.map((e) => [e.route.model, e.route.keyLabel ?? null, e.paramsScope])).toEqual([
      ['gpt-4o', null, 'virtual:vm-1'],
      ['claude-opus-4-6', null, 'virtual:vm-1'],
      ['deepseek-chat', null, 'tier:default'],
      // Same model on another key is another route.
      ['gpt-4o', 'Work', 'tier:default'],
    ]);
    expect(chain.filter((e) => e.fromDefault)).toHaveLength(2);
  });

  it('tolerates an empty virtual chain and a missing Default tier', () => {
    expect(
      buildVirtualModelChain(
        vm({ override_route: null, fallback_routes: null, continue_on_default: true }),
        null,
      ),
    ).toEqual([]);
  });
});

describe('tierChainRoutes', () => {
  it('walks override, fallbacks, then the legacy auto-assigned route', () => {
    expect(
      tierChainRoutes({
        override_route: route('a', 'm1'),
        auto_assigned_route: route('a', 'auto'),
        fallback_routes: [route('a', 'm2')],
      }).map((r) => r.model),
    ).toEqual(['m1', 'm2', 'auto']);
  });

  it('leads with the auto-assigned route when there is no override', () => {
    expect(
      tierChainRoutes({
        override_route: null,
        auto_assigned_route: route('a', 'auto'),
        fallback_routes: [route('a', 'm2')],
      }).map((r) => r.model),
    ).toEqual(['auto', 'm2']);
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
