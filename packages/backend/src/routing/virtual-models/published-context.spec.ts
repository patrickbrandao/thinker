import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { contextWindowFields } from '../../model-discovery/model-fetcher';
import { snapshotRouteState } from './virtual-model-chain';
import { publishedContextWindow } from './published-context';

function model(overrides: Partial<DiscoveredModel>): DiscoveredModel {
  return {
    id: 'm',
    displayName: 'm',
    provider: 'openai',
    contextWindow: 128000,
    inputPricePerToken: null,
    outputPricePerToken: null,
    capabilityReasoning: false,
    capabilityCode: false,
    qualityScore: 3,
    ...overrides,
  };
}

describe('contextWindowFields', () => {
  it('keeps a reported window and marks a missing one as the stand-in default', () => {
    expect(contextWindowFields(65536)).toEqual({ contextWindow: 65536 });
    expect(contextWindowFields(undefined)).toEqual({
      contextWindow: 1_000_000,
      contextWindowSource: 'default',
    });
    expect(contextWindowFields(0).contextWindowSource).toBe('default');
  });
});

describe('publishedContextWindow', () => {
  it('only counts openrouter :free models for openrouter/free', () => {
    const router = model({ id: 'openrouter/free', provider: 'openrouter' });
    const others = [
      model({ id: 'x:free', provider: 'openrouter', contextWindow: 40000 }),
      model({ id: 'y:free', provider: 'openrouter', contextWindowSource: 'default' }),
      model({ id: 'z:free', provider: 'openai', contextWindow: 2048 }),
    ];
    expect(publishedContextWindow(router, [router, ...others])).toBe(40000);
  });
});

describe('snapshotRouteState with a stand-in window', () => {
  it('reports an available route with an unknown window', () => {
    const snapshot = {
      catalog: [model({ id: 'gpt-x', contextWindowSource: 'default', contextWindow: 1_000_000 })],
      providers: [],
    };
    expect(
      snapshotRouteState({ provider: 'openai', authType: 'api_key', model: 'gpt-x' }, snapshot),
    ).toEqual({ state: 'available', contextWindow: null });
  });
});
