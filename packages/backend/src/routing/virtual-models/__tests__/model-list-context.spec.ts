import type { ModelRoute } from 'thinker-shared';
import type { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import {
  autoContextLength,
  specificityContextWindow,
  tierContextWindow,
  type SpecificityContextSource,
  type TierContextSource,
} from '../model-list-context';
import type { RouteSnapshot } from '../virtual-model-chain';

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

const CATALOG: DiscoveredModel[] = [
  discovered('gpt-4o', 'openai', 128000),
  discovered('gpt-4o-mini', 'openai', 100000),
  discovered('claude-sonnet-4-5', 'anthropic', 200000),
  discovered('deepseek-chat', 'deepseek', 64000),
  discovered('mystery', 'mistral', 0),
];

/** Every connection in the catalog is connected for the agent. */
const SNAPSHOT: RouteSnapshot = {
  catalog: CATALOG,
  providers: ['openai', 'anthropic', 'deepseek', 'mistral'].map((provider) => ({
    provider,
    authType: 'api_key',
  })),
};

const tier = (name: string, overrides: Partial<TierContextSource> = {}): TierContextSource => ({
  tier: name,
  override_route: null,
  auto_assigned_route: null,
  fallback_routes: null,
  response_mode: 'buffered',
  ...overrides,
});

const allTiers = (overrides: Record<string, Partial<TierContextSource>> = {}) =>
  ['simple', 'standard', 'complex', 'reasoning', 'default'].map((name) =>
    tier(name, overrides[name]),
  );

const specificity = (
  overrides: Partial<SpecificityContextSource> = {},
): SpecificityContextSource => ({
  override_route: null,
  fallback_routes: null,
  response_mode: 'buffered',
  ...overrides,
});

describe('tierContextWindow', () => {
  it('uses the override and its fallbacks when the override is available', () => {
    expect(
      tierContextWindow(
        tier('default', {
          override_route: route('openai', 'gpt-4o'),
          fallback_routes: [route('anthropic', 'claude-sonnet-4-5')],
          // Never reached while the override is available.
          auto_assigned_route: route('deepseek', 'deepseek-chat'),
        }),
        SNAPSHOT,
      ),
    ).toEqual({ kind: 'known', value: 128000 });
  });

  it('uses the legacy auto-assigned route when there is no override', () => {
    expect(
      tierContextWindow(
        tier('default', { auto_assigned_route: route('deepseek', 'deepseek-chat') }),
        SNAPSHOT,
      ),
    ).toEqual({ kind: 'known', value: 64000 });
  });

  it('walks fallbacks then the auto-assigned route when the override is unavailable', () => {
    expect(
      tierContextWindow(
        tier('default', {
          override_route: route('openai', 'gpt-retired'),
          fallback_routes: [route('anthropic', 'claude-sonnet-4-5')],
          auto_assigned_route: route('deepseek', 'deepseek-chat'),
        }),
        SNAPSHOT,
      ),
    ).toEqual({ kind: 'known', value: 64000 });
  });

  it('is empty without any route', () => {
    expect(tierContextWindow(tier('default'), SNAPSHOT)).toEqual({ kind: 'empty' });
  });

  it('skips a route of a disconnected provider', () => {
    // Groq is neither in the catalog nor in the agent's credential rows.
    expect(
      tierContextWindow(
        tier('default', {
          override_route: route('groq', 'llama-3.3-70b'),
          fallback_routes: [route('openai', 'gpt-4o')],
          auto_assigned_route: route('deepseek', 'deepseek-chat'),
        }),
        SNAPSHOT,
      ),
    ).toEqual({ kind: 'known', value: 64000 });
    expect(
      tierContextWindow(tier('default', { override_route: route('groq', 'llama') }), SNAPSHOT),
    ).toEqual({ kind: 'empty' });
  });

  it('is unknown on cold discovery of a connected provider', () => {
    const cold: RouteSnapshot = {
      ...SNAPSHOT,
      providers: [...SNAPSHOT.providers, { provider: 'groq', authType: 'api_key' }],
    };
    expect(
      tierContextWindow(tier('default', { override_route: route('groq', 'llama') }), cold),
    ).toEqual({ kind: 'unknown' });
  });

  it('is unknown when a route window is unknown', () => {
    expect(
      tierContextWindow(tier('default', { override_route: route('mistral', 'mystery') }), SNAPSHOT),
    ).toEqual({ kind: 'unknown' });
  });
});

describe('specificityContextWindow', () => {
  it('uses the override and its fallbacks', () => {
    expect(
      specificityContextWindow(
        specificity({
          override_route: route('anthropic', 'claude-sonnet-4-5'),
          fallback_routes: [route('openai', 'gpt-4o-mini')],
        }),
        SNAPSHOT,
      ),
    ).toEqual({ kind: 'known', value: 100000 });
  });

  it('is unreachable (empty) without an override or with an unavailable one', () => {
    expect(specificityContextWindow(specificity(), SNAPSHOT)).toEqual({ kind: 'empty' });
    expect(
      specificityContextWindow(
        specificity({
          override_route: route('openai', 'gpt-retired'),
          fallback_routes: [route('openai', 'gpt-4o')],
        }),
        SNAPSHOT,
      ),
    ).toEqual({ kind: 'empty' });
  });
});

describe('autoContextLength', () => {
  describe('complexity routing off', () => {
    it('is the Default chain window', () => {
      expect(
        autoContextLength({
          complexityRoutingEnabled: false,
          tiers: allTiers({
            default: {
              override_route: route('openai', 'gpt-4o'),
              fallback_routes: [route('deepseek', 'deepseek-chat')],
            },
            // Other slots are not reachable with complexity routing off.
            simple: { override_route: route('openai', 'gpt-4o-mini') },
          }),
          specificity: [specificity({ override_route: route('openai', 'gpt-4o-mini') })],
          snapshot: SNAPSHOT,
        }),
      ).toBe(64000);
    });

    it('stays present when the Default has only the legacy auto-assigned route', () => {
      expect(
        autoContextLength({
          complexityRoutingEnabled: false,
          tiers: allTiers({ default: { auto_assigned_route: route('openai', 'gpt-4o') } }),
          specificity: [],
          snapshot: SNAPSHOT,
        }),
      ).toBe(128000);
    });

    it('is omitted when the Default is empty or missing', () => {
      const input = { complexityRoutingEnabled: false, specificity: [], snapshot: SNAPSHOT };
      expect(autoContextLength({ ...input, tiers: allTiers() })).toBeNull();
      expect(autoContextLength({ ...input, tiers: [] })).toBeNull();
    });

    it('is omitted when a Default route window is unknown', () => {
      expect(
        autoContextLength({
          complexityRoutingEnabled: false,
          tiers: allTiers({
            default: {
              override_route: route('openai', 'gpt-4o'),
              fallback_routes: [route('mistral', 'mystery')],
            },
          }),
          specificity: [],
          snapshot: SNAPSHOT,
        }),
      ).toBeNull();
    });

    it('is omitted when a Default route connection has no models in the snapshot', () => {
      expect(
        autoContextLength({
          complexityRoutingEnabled: false,
          tiers: allTiers({ default: { override_route: route('groq', 'llama-3') } }),
          specificity: [],
          snapshot: SNAPSHOT,
        }),
      ).toBeNull();
    });
  });

  describe('complexity routing on', () => {
    it('is the minimum across the complexity slots, the default and specificity', () => {
      const tiers = allTiers({
        simple: { override_route: route('openai', 'gpt-4o') },
        standard: { override_route: route('anthropic', 'claude-sonnet-4-5') },
        default: { auto_assigned_route: route('openai', 'gpt-4o') },
      });
      expect(
        autoContextLength({
          complexityRoutingEnabled: true,
          tiers,
          specificity: [],
          snapshot: SNAPSHOT,
        }),
      ).toBe(128000);
      expect(
        autoContextLength({
          complexityRoutingEnabled: true,
          tiers,
          specificity: [specificity({ override_route: route('deepseek', 'deepseek-chat') })],
          snapshot: SNAPSHOT,
        }),
      ).toBe(64000);
    });

    it('takes the reasoning slot into account', () => {
      expect(
        autoContextLength({
          complexityRoutingEnabled: true,
          tiers: allTiers({
            default: { override_route: route('openai', 'gpt-4o') },
            reasoning: { override_route: route('openai', 'gpt-4o-mini') },
          }),
          specificity: [],
          snapshot: SNAPSHOT,
        }),
      ).toBe(100000);
    });

    it('skips slots and specificity that cannot serve a request', () => {
      expect(
        autoContextLength({
          complexityRoutingEnabled: true,
          tiers: allTiers({
            default: { override_route: route('anthropic', 'claude-sonnet-4-5') },
            // Unavailable override, no fallbacks: never serves a request.
            complex: { override_route: route('openai', 'gpt-retired') },
          }),
          specificity: [specificity({ override_route: route('deepseek', 'gone') })],
          snapshot: SNAPSHOT,
        }),
      ).toBe(200000);
    });

    it('is omitted when any reachable destination has an unknown window', () => {
      expect(
        autoContextLength({
          complexityRoutingEnabled: true,
          tiers: allTiers({
            default: { override_route: route('openai', 'gpt-4o') },
            simple: { override_route: route('mistral', 'mystery') },
          }),
          specificity: [],
          snapshot: SNAPSHOT,
        }),
      ).toBeNull();
    });

    it('is omitted when nothing is reachable', () => {
      expect(
        autoContextLength({
          complexityRoutingEnabled: true,
          tiers: allTiers(),
          specificity: [],
          snapshot: SNAPSHOT,
        }),
      ).toBeNull();
    });

    it('ignores rows that are not tier slots', () => {
      expect(
        autoContextLength({
          complexityRoutingEnabled: true,
          tiers: [
            ...allTiers({ default: { override_route: route('openai', 'gpt-4o') } }),
            tier('legacy-slot', { override_route: route('deepseek', 'deepseek-chat') }),
          ],
          specificity: [],
          snapshot: SNAPSHOT,
        }),
      ).toBe(128000);
    });
  });
});
