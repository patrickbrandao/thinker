import { describe, expect, it } from 'vitest';
import type { AvailableModel } from '../../src/services/api';
import { routeNotInCatalog } from '../../src/lib/route-catalog';

const model = (provider: string, model_name: string, auth_type?: AvailableModel['auth_type']) =>
  ({ provider, model_name, auth_type }) as AvailableModel;

const models = [
  model('openai', 'gpt-5', 'api_key'),
  model('openrouter', 'anthropic/claude-sonnet-4.5', 'api_key'),
  model('openrouter', 'deepseek/deepseek-v4', 'api_key'),
];

describe('routeNotInCatalog', () => {
  it('flags a route whose connection lists models but not this one', () => {
    expect(
      routeNotInCatalog({ provider: 'openai', authType: 'api_key', model: 'gpt-4-old' }, models),
    ).toBe(true);
    expect(
      routeNotInCatalog({ provider: 'OpenAI', authType: 'api_key', model: 'gpt-5' }, models),
    ).toBe(false);
  });

  it('never flags while loading or when the connection lists nothing', () => {
    const route = { provider: 'openai', authType: 'api_key' as const, model: 'gpt-4-old' };
    expect(routeNotInCatalog(route, [])).toBe(false);
    expect(
      routeNotInCatalog(
        { provider: 'openai', authType: 'subscription', model: 'gpt-4-old' },
        models,
      ),
    ).toBe(false);
    expect(
      routeNotInCatalog({ provider: 'mistral', authType: 'api_key', model: 'x' }, models),
    ).toBe(false);
    expect(routeNotInCatalog(null, models)).toBe(false);
  });

  it('matches OpenRouter models under their own id and the picker vendor group', () => {
    expect(
      routeNotInCatalog(
        { provider: 'openrouter', authType: 'api_key', model: 'deepseek/deepseek-v4' },
        models,
      ),
    ).toBe(false);
    expect(
      routeNotInCatalog(
        { provider: 'anthropic', authType: 'api_key', model: 'anthropic/claude-sonnet-4.5' },
        models,
      ),
    ).toBe(false);
    expect(
      routeNotInCatalog(
        { provider: 'openrouter', authType: 'api_key', model: 'meta/gone' },
        models,
      ),
    ).toBe(true);
  });
});
