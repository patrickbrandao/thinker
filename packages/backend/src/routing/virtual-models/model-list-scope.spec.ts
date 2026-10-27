import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { catalogModelMatchesRoute, collectLinkedRoutes } from './model-list-scope';

const model = (overrides: Partial<DiscoveredModel>): DiscoveredModel =>
  ({
    id: 'm',
    provider: 'openai',
    authType: 'api_key',
    contextWindow: 1000,
    ...overrides,
  }) as DiscoveredModel;

const r = (model: string, provider = 'openai') => ({
  provider,
  authType: 'api_key' as const,
  model,
});

const tier = (slot: string, override: unknown, fallbacks: unknown[] = []) => ({
  tier: slot,
  override_route: override,
  auto_assigned_route: null,
  fallback_routes: fallbacks,
  response_mode: null,
});

describe('collectLinkedRoutes', () => {
  const snapshot = {
    catalog: [model({ id: 'a' }), model({ id: 'b' }), model({ id: 'c' }), model({ id: 'v' })],
    providers: [{ provider: 'openai', authType: 'api_key' }],
  };
  const tiers = [tier('default', r('a'), [r('b')]), tier('complex', r('c'))] as never[];
  const virtuals = [
    { id: 'vm-1', override_route: r('v'), fallback_routes: [], continue_on_default: false },
  ] as never[];

  it('uses only the Default tier with complexity routing off', async () => {
    const routes = await collectLinkedRoutes({
      complexityRoutingEnabled: false,
      tiers,
      specificity: [],
      virtuals,
      snapshot,
    });
    expect(routes.map((x) => x.model)).toEqual(['a', 'b', 'v']);
  });

  it('adds every tier slot and specificity with complexity routing on', async () => {
    const routes = await collectLinkedRoutes({
      complexityRoutingEnabled: true,
      tiers,
      specificity: [
        { override_route: r('s'), fallback_routes: [r('t')], response_mode: null },
      ] as never[],
      virtuals,
      snapshot,
    });
    expect(routes.map((x) => x.model)).toEqual(['a', 'b', 'c', 's', 't', 'v']);
  });
});

describe('catalogModelMatchesRoute', () => {
  it('matches provider aliases, auth type and model id', () => {
    expect(catalogModelMatchesRoute(model({ id: 'x' }), r('x'))).toBe(true);
    expect(catalogModelMatchesRoute(model({ id: 'x' }), r('y'))).toBe(false);
    expect(catalogModelMatchesRoute(model({ id: 'x' }), r('x', 'anthropic'))).toBe(false);
    expect(catalogModelMatchesRoute(model({ id: 'x', authType: 'subscription' }), r('x'))).toBe(
      false,
    );
  });
});
