import { describe, it, expect } from 'vitest';
import { customProviderAliases, publicModelId } from '../../src/services/public-model-id';

describe('customProviderAliases', () => {
  it('maps custom:<id> to the alias for providers that have one', () => {
    const map = customProviderAliases([
      { id: 'a1', alias: 'acme' },
      { id: 'b2', alias: null },
      { id: 'c3', alias: '' },
    ]);
    expect([...map.entries()]).toEqual([['custom:a1', 'acme']]);
  });

  it('accepts no argument and an empty list', () => {
    expect(customProviderAliases().size).toBe(0);
    expect(customProviderAliases([]).size).toBe(0);
  });
});

describe('publicModelId', () => {
  it('prefixes a plain provider/model pair', () => {
    expect(publicModelId({ model: 'gpt-5.5', provider: 'openai' })).toBe('openai/gpt-5.5');
  });

  it('lowercases the provider prefix', () => {
    expect(publicModelId({ model: 'gpt-5.5', provider: 'OpenAI' })).toBe('openai/gpt-5.5');
  });

  it('does not double-prefix a model that already carries the provider (any case)', () => {
    expect(publicModelId({ model: 'openai/gpt-5.5', provider: 'openai' })).toBe('openai/gpt-5.5');
    expect(publicModelId({ model: 'OpenAI/gpt-5.5', provider: 'openai' })).toBe('OpenAI/gpt-5.5');
  });

  it('keeps other slashes in the model (OpenRouter style)', () => {
    expect(publicModelId({ model: 'meta/llama-4', provider: 'openrouter' })).toBe(
      'openrouter/meta/llama-4',
    );
  });

  it('adds -subscription for subscription auth, once', () => {
    expect(publicModelId({ model: 'gpt-5.5', provider: 'openai', authType: 'subscription' })).toBe(
      'openai/gpt-5.5-subscription',
    );
    expect(
      publicModelId({
        model: 'openai/gpt-5.5-subscription',
        provider: 'openai',
        authType: 'subscription',
      }),
    ).toBe('openai/gpt-5.5-subscription');
  });

  it('leaves the auto model bare for subscriptions', () => {
    expect(publicModelId({ model: 'auto', provider: 'anthropic', authType: 'subscription' })).toBe(
      'auto',
    );
  });

  it('does not suffix api_key, local, null or undefined auth', () => {
    for (const authType of ['api_key', 'local', null, undefined]) {
      expect(publicModelId({ model: 'm', provider: 'p', authType })).toBe('p/m');
    }
  });

  describe('custom providers', () => {
    const aliases = new Map([['custom:u1', 'acme']]);

    it('uses the alias as prefix', () => {
      expect(publicModelId({ model: 'llama', provider: 'custom:u1' }, aliases)).toBe('acme/llama');
    });

    it('strips an internal custom:<id>/ prefix before applying the alias', () => {
      expect(publicModelId({ model: 'custom:u1/llama', provider: 'custom:u1' }, aliases)).toBe(
        'acme/llama',
      );
    });

    it('returns the bare model when the provider has no alias', () => {
      expect(publicModelId({ model: 'custom:u2/llama', provider: 'custom:u2' }, aliases)).toBe(
        'custom:u2/llama',
      );
      expect(publicModelId({ model: 'llama', provider: 'custom:u2' })).toBe('llama');
    });

    it('treats the custom prefix case-insensitively', () => {
      expect(
        publicModelId({ model: 'llama', provider: 'Custom:u1' }, new Map([['Custom:u1', 'x']])),
      ).toBe('x/llama');
    });

    it('does not add -subscription to custom providers', () => {
      expect(
        publicModelId({ model: 'llama', provider: 'custom:u1', authType: 'subscription' }, aliases),
      ).toBe('acme/llama');
    });
  });
});
