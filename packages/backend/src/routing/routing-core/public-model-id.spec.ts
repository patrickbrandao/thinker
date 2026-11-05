import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import {
  OPENAI_MODEL_ID_AUTO,
  SUBSCRIPTION_MODEL_SUFFIX,
  openAiModelId,
  subscriptionOpenAiModelId,
} from './public-model-id';

function model(overrides: Partial<DiscoveredModel>): DiscoveredModel {
  return {
    id: 'gpt-5',
    displayName: 'GPT-5',
    provider: 'OpenAI',
    contextWindow: 128000,
    inputPricePerToken: null,
    outputPricePerToken: null,
    capabilityReasoning: false,
    capabilityCode: false,
    qualityScore: 3,
    authType: 'api_key',
    ...overrides,
  };
}

describe('constants', () => {
  it('exposes the reserved auto id and the subscription suffix', () => {
    expect(OPENAI_MODEL_ID_AUTO).toBe('auto');
    expect(SUBSCRIPTION_MODEL_SUFFIX).toBe('-subscription');
  });
});

describe('subscriptionOpenAiModelId', () => {
  it('prefixes the provider and appends the subscription suffix', () => {
    expect(subscriptionOpenAiModelId('anthropic', 'claude-sonnet-4')).toBe(
      'anthropic/claude-sonnet-4-subscription',
    );
  });

  it('lowercases the provider', () => {
    expect(subscriptionOpenAiModelId('Anthropic', 'claude-sonnet-4')).toBe(
      'anthropic/claude-sonnet-4-subscription',
    );
  });

  it('does not double the provider prefix (case-insensitive)', () => {
    expect(subscriptionOpenAiModelId('openai', 'openai/gpt-5')).toBe('openai/gpt-5-subscription');
    expect(subscriptionOpenAiModelId('openai', 'OpenAI/gpt-5')).toBe('OpenAI/gpt-5-subscription');
  });

  it('does not double the suffix', () => {
    expect(subscriptionOpenAiModelId('openai', 'gpt-5-subscription')).toBe(
      'openai/gpt-5-subscription',
    );
    expect(subscriptionOpenAiModelId('openai', 'openai/gpt-5-subscription')).toBe(
      'openai/gpt-5-subscription',
    );
  });

  it('is idempotent', () => {
    const once = subscriptionOpenAiModelId('openai', 'gpt-5');
    expect(subscriptionOpenAiModelId('openai', once)).toBe(once);
  });

  it('leaves auto untouched', () => {
    expect(subscriptionOpenAiModelId('openai', 'auto')).toBe('auto');
  });

  it('leaves custom provider ids untouched', () => {
    expect(subscriptionOpenAiModelId('custom:abc', 'custom:abc/m1')).toBe('custom:abc/m1');
    expect(subscriptionOpenAiModelId('Custom:ABC', 'm1')).toBe('m1');
  });

  it('keeps the slashes of nested provider-native ids', () => {
    expect(subscriptionOpenAiModelId('openrouter', 'anthropic/claude')).toBe(
      'openrouter/anthropic/claude-subscription',
    );
  });
});

describe('openAiModelId', () => {
  it('qualifies a bare api-key model with its lowercase provider', () => {
    expect(openAiModelId(model({ id: 'gpt-5', provider: 'OpenAI' }))).toBe('openai/gpt-5');
  });

  it('keeps an already qualified id', () => {
    expect(openAiModelId(model({ id: 'openai/gpt-5', provider: 'openai' }))).toBe('openai/gpt-5');
    expect(openAiModelId(model({ id: 'OpenAI/gpt-5', provider: 'openai' }))).toBe('OpenAI/gpt-5');
  });

  it('adds the subscription suffix for subscription models', () => {
    expect(openAiModelId(model({ authType: 'subscription' }))).toBe('openai/gpt-5-subscription');
  });

  it('does not mark local or missing auth types as subscription', () => {
    expect(openAiModelId(model({ authType: 'local' }))).toBe('openai/gpt-5');
    expect(openAiModelId(model({ authType: undefined }))).toBe('openai/gpt-5');
  });

  it('gives the same model different ids under api key and subscription', () => {
    const apiKey = openAiModelId(model({ authType: 'api_key' }));
    const subscription = openAiModelId(model({ authType: 'subscription' }));
    expect(apiKey).not.toBe(subscription);
  });

  describe('custom providers', () => {
    it('keeps the internal id when the provider has no alias', () => {
      expect(openAiModelId(model({ provider: 'custom:abc', id: 'custom:abc/llama' }))).toBe(
        'custom:abc/llama',
      );
    });

    it('publishes <alias>/<model_name> when an alias is set', () => {
      expect(
        openAiModelId(
          model({ provider: 'custom:abc', id: 'custom:abc/llama', providerAlias: 'home' }),
        ),
      ).toBe('home/llama');
    });

    it('keeps slashes in the model name behind the alias', () => {
      expect(
        openAiModelId(
          model({ provider: 'custom:abc', id: 'custom:abc/org/llama', providerAlias: 'home' }),
        ),
      ).toBe('home/org/llama');
    });

    it('uses the whole id when it lacks the provider prefix', () => {
      expect(
        openAiModelId(model({ provider: 'custom:abc', id: 'llama', providerAlias: 'home' })),
      ).toBe('home/llama');
    });

    it('ignores the subscription auth type for custom providers', () => {
      expect(
        openAiModelId(
          model({ provider: 'custom:abc', id: 'custom:abc/m', authType: 'subscription' }),
        ),
      ).toBe('custom:abc/m');
    });
  });
});
