import type { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import {
  explicitModelRouteCandidate,
  openAiModelId,
  routeForOpenAiModelId,
  subscriptionOpenAiModelId,
} from '../openai-model-id';

function model(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    inputPricePerToken: null,
    outputPricePerToken: null,
    capabilityReasoning: false,
    capabilityCode: false,
    qualityScore: 4,
    authType: 'api_key',
    ...overrides,
  };
}

describe('OpenAI model ids', () => {
  it('formats provider-qualified API-key model ids', () => {
    expect(openAiModelId(model({ id: 'gpt-4o-mini', provider: 'openai' }))).toBe(
      'openai/gpt-4o-mini',
    );
  });

  it('adds the subscription suffix for subscription routes', () => {
    expect(openAiModelId(model({ id: 'gpt-5.5', authType: 'subscription' }))).toBe(
      'openai/gpt-5.5-subscription',
    );
    expect(openAiModelId(model({ id: 'gpt-5.5-subscription', authType: 'subscription' }))).toBe(
      'openai/gpt-5.5-subscription',
    );
  });

  it('encodes native subscription models idempotently', () => {
    expect(subscriptionOpenAiModelId('openai', 'auto')).toBe('auto');
    expect(subscriptionOpenAiModelId('openai', 'gpt-5.5')).toBe('openai/gpt-5.5-subscription');
    expect(subscriptionOpenAiModelId('openai', 'openai/gpt-5.5-subscription')).toBe(
      'openai/gpt-5.5-subscription',
    );
    expect(subscriptionOpenAiModelId('opencode-go', 'opencode-go/glm-5.1')).toBe(
      'opencode-go/glm-5.1-subscription',
    );
  });

  it('preserves provider-prefixed provider-native model ids', () => {
    expect(
      openAiModelId(
        model({
          id: 'opencode-go/glm-5.1',
          provider: 'opencode-go',
          authType: 'subscription',
        }),
      ),
    ).toBe('opencode-go/glm-5.1-subscription');
  });

  it('leaves custom model ids unchanged when the provider has no alias', () => {
    expect(
      openAiModelId(
        model({
          id: 'custom:provider-1/model-a',
          provider: 'custom:provider-1',
        }),
      ),
    ).toBe('custom:provider-1/model-a');
  });

  it('publishes custom models under the provider alias', () => {
    expect(
      openAiModelId(
        model({
          id: 'custom:provider-1/alibaba/qwen-3-14b',
          provider: 'custom:provider-1',
          providerAlias: 'vercel-ai-gateway',
        }),
      ),
    ).toBe('vercel-ai-gateway/alibaba/qwen-3-14b');
  });

  it('keeps a custom model id without the provider prefix intact under the alias', () => {
    expect(
      openAiModelId(
        model({ id: 'bare-model', provider: 'custom:provider-1', providerAlias: 'gw' }),
      ),
    ).toBe('gw/bare-model');
  });

  it('resolves the alias form and the internal form of a custom model to the same route', () => {
    const custom = model({
      id: 'custom:provider-1/alibaba/qwen-3-14b',
      provider: 'custom:provider-1',
      providerAlias: 'vercel-ai-gateway',
    });
    const route = {
      provider: 'custom:provider-1',
      authType: 'api_key',
      model: 'custom:provider-1/alibaba/qwen-3-14b',
    };

    expect(routeForOpenAiModelId('vercel-ai-gateway/alibaba/qwen-3-14b', [custom])).toEqual(route);
    expect(routeForOpenAiModelId('custom:provider-1/alibaba/qwen-3-14b', [custom])).toEqual(route);
    expect(routeForOpenAiModelId('alibaba/qwen-3-14b', [custom])).toBeNull();
  });

  describe('legacy alias of a custom provider renamed off a reserved id', () => {
    const renamed = model({
      id: 'custom:cp-lm/qwen/qwen3-8b',
      provider: 'custom:cp-lm',
      providerAlias: 'lmstudio-custom',
      providerLegacyAlias: 'lmstudio',
    });
    const customRoute = {
      provider: 'custom:cp-lm',
      authType: 'api_key',
      model: 'custom:cp-lm/qwen/qwen3-8b',
    };

    it('publishes only the new alias', () => {
      expect(openAiModelId(renamed)).toBe('lmstudio-custom/qwen/qwen3-8b');
    });

    it('still routes the old alias, the new alias and the internal key to the custom provider', () => {
      expect(routeForOpenAiModelId('lmstudio/qwen/qwen3-8b', [renamed])).toEqual(customRoute);
      expect(routeForOpenAiModelId('lmstudio-custom/qwen/qwen3-8b', [renamed])).toEqual(
        customRoute,
      );
      expect(routeForOpenAiModelId('custom:cp-lm/qwen/qwen3-8b', [renamed])).toEqual(customRoute);
    });

    it('lets the built-in route win when it publishes the same id', () => {
      const native = model({ id: 'qwen/qwen3-8b', provider: 'lmstudio', authType: 'local' });
      const expected = { provider: 'lmstudio', authType: 'local', model: 'qwen/qwen3-8b' };
      expect(routeForOpenAiModelId('lmstudio/qwen/qwen3-8b', [renamed, native])).toEqual(expected);
      expect(routeForOpenAiModelId('lmstudio/qwen/qwen3-8b', [native, renamed])).toEqual(expected);
    });

    it('falls back to the custom provider for a model only it serves', () => {
      const native = model({ id: 'gemma-3', provider: 'lmstudio', authType: 'local' });
      expect(routeForOpenAiModelId('lmstudio/qwen/qwen3-8b', [native, renamed])).toEqual(
        customRoute,
      );
    });

    it('ignores a legacy alias on a non-custom model', () => {
      const odd = model({ id: 'gpt-4o', provider: 'openai', providerLegacyAlias: 'legacy' });
      expect(routeForOpenAiModelId('legacy/gpt-4o', [odd])).toBeNull();
    });
  });

  it('resolves listed ids back to routable provider/auth/model triples', () => {
    const route = routeForOpenAiModelId('openrouter/anthropic/claude-sonnet-4.5', [
      model({
        id: 'anthropic/claude-sonnet-4.5',
        provider: 'openrouter',
        authType: 'api_key',
      }),
    ]);

    expect(route).toEqual({
      provider: 'openrouter',
      authType: 'api_key',
      model: 'anthropic/claude-sonnet-4.5',
    });
  });

  it('returns null for unlisted or auth-less ids', () => {
    expect(routeForOpenAiModelId('openai/gpt-4o', [])).toBeNull();
    expect(routeForOpenAiModelId('openai/gpt-4o', [model({ id: 'gpt-4o-mini' })])).toBeNull();
    expect(routeForOpenAiModelId('openai/gpt-4o', [model({ authType: undefined })])).toBeNull();
  });

  it('resolves a bare provider-native name carried by one connection', () => {
    expect(routeForOpenAiModelId('gpt-5.4-nano', [model({ id: 'gpt-5.4-nano' })])).toEqual({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-5.4-nano',
    });
  });

  it('resolves a bare prefixed id whose published form carries the subscription suffix', () => {
    expect(
      routeForOpenAiModelId('copilot/gpt-4o', [
        model({ id: 'copilot/gpt-4o', provider: 'copilot', authType: 'subscription' }),
      ]),
    ).toEqual({ provider: 'copilot', authType: 'subscription', model: 'copilot/gpt-4o' });
  });

  it('prefers the provider-qualified id over a bare collision', () => {
    const route = routeForOpenAiModelId('openai/gpt-4o', [
      model({ id: 'openai/gpt-4o', provider: 'openrouter' }),
      model({ id: 'gpt-4o', provider: 'openai' }),
    ]);

    expect(route).toEqual({ provider: 'openai', authType: 'api_key', model: 'gpt-4o' });
  });

  // Two connections carrying one bare id: the caller cannot know which was
  // meant, so the route helper refuses to guess.
  it('returns null for a bare name carried by two connections', () => {
    expect(
      routeForOpenAiModelId('gpt-4o', [
        model({ id: 'gpt-4o', authType: 'api_key' }),
        model({ id: 'gpt-4o', authType: 'subscription' }),
      ]),
    ).toBeNull();
  });

  it('returns null for a bare name that matches nothing', () => {
    expect(routeForOpenAiModelId('some-retired-model', [model()])).toBeNull();
  });

  it('parses an uncatalogued provider-qualified model into its transport route', () => {
    expect(explicitModelRouteCandidate('openrouter/anthropic/claude-new')).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-new',
      providerQualified: true,
    });
  });

  it('preserves a custom provider model id for custom endpoint resolution', () => {
    expect(explicitModelRouteCandidate('custom:provider-1/model-new')).toEqual({
      provider: 'custom:provider-1',
      model: 'custom:provider-1/model-new',
      providerQualified: true,
    });
  });

  it('infers the provider for an uncatalogued bare native model', () => {
    expect(explicitModelRouteCandidate('claude-new')).toEqual({
      provider: 'anthropic',
      model: 'claude-new',
      providerQualified: false,
    });
  });

  it('refuses a bare model whose provider cannot be inferred', () => {
    expect(explicitModelRouteCandidate('some-retired-model')).toBeNull();
  });
});
