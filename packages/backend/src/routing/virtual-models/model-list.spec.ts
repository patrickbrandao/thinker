import type { ModelRoute } from 'thinker-shared';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { listedCatalogModels } from './model-list';
import type { ModelListRouting } from './model-list-routing.service';

function model(
  provider: string,
  id: string,
  extra: Partial<DiscoveredModel> = {},
): DiscoveredModel {
  return {
    id,
    displayName: id,
    provider,
    contextWindow: 1000,
    inputPricePerToken: null,
    outputPricePerToken: null,
    capabilityReasoning: false,
    capabilityCode: false,
    qualityScore: 3,
    authType: 'api_key',
    ...extra,
  };
}

const routing = (overrides: Partial<ModelListRouting> = {}): ModelListRouting => ({
  autoContextLength: null,
  virtuals: [],
  ...overrides,
});

const route = (provider: string, m: string, authType: ModelRoute['authType'] = 'api_key') => ({
  provider,
  authType,
  model: m,
});

describe('listedCatalogModels', () => {
  const models = [
    model('openai', 'gpt-5'),
    model('anthropic', 'claude-sonnet'),
    model('openai', 'gpt-5', { authType: 'subscription' }),
  ];

  it('lists every model with its public id in open mode (the default)', () => {
    const out = listedCatalogModels(models, routing());
    expect(out.map((m) => m.id)).toEqual([
      'openai/gpt-5',
      'anthropic/claude-sonnet',
      'openai/gpt-5-subscription',
    ]);
    expect(out[0].model).toBe(models[0]);
  });

  it('lists nothing in closed mode', () => {
    expect(listedCatalogModels(models, routing({ listing: 'closed' }))).toEqual([]);
  });

  it('lists only the models the linked routes reach in restricted mode', () => {
    const out = listedCatalogModels(
      models,
      routing({ listing: 'restricted', linkedRoutes: [route('anthropic', 'claude-sonnet')] }),
    );
    expect(out.map((m) => m.id)).toEqual(['anthropic/claude-sonnet']);
  });

  it('respects the auth type of a linked route', () => {
    const out = listedCatalogModels(
      models,
      routing({
        listing: 'restricted',
        linkedRoutes: [route('openai', 'gpt-5', 'subscription')],
      }),
    );
    expect(out.map((m) => m.id)).toEqual(['openai/gpt-5-subscription']);
  });

  it('lists nothing in restricted mode without linked routes', () => {
    expect(listedCatalogModels(models, routing({ listing: 'restricted' }))).toEqual([]);
  });

  it('keeps only the first model for a duplicated public id', () => {
    const dup = [model('openai', 'gpt-5'), model('openai', 'gpt-5', { displayName: 'dup' })];
    const out = listedCatalogModels(dup, routing());
    expect(out).toHaveLength(1);
    expect(out[0].model.displayName).toBe('gpt-5');
  });

  it('never lists the reserved id auto', () => {
    const out = listedCatalogModels(
      [model('custom:abc', 'auto'), model('custom:abc', 'custom:abc/m', { providerAlias: 'x' })],
      routing(),
    );
    expect(out.map((m) => m.id)).toEqual(['x/m']);
  });

  it('drops ids that an enabled virtual model shadows, case-insensitively', () => {
    const out = listedCatalogModels(
      models,
      routing({ virtuals: [{ name: 'OpenAI/GPT-5', context_length: null }] }),
    );
    expect(out.map((m) => m.id)).toEqual(['anthropic/claude-sonnet', 'openai/gpt-5-subscription']);
  });

  it('returns an empty list for an empty catalog', () => {
    expect(listedCatalogModels([], routing())).toEqual([]);
  });
});
