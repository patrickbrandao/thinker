import { ProviderParamSpecService } from './provider-param-spec.service';
import { sanitizeModelParams } from '../model-params/sanitize-model-params';

describe('OpenRouter provider routing params', () => {
  const service = new ProviderParamSpecService();

  it('are offered on every OpenRouter API-key model and nowhere else', async () => {
    const specs = await service.getSpecs('openrouter', 'api_key', 'some-vendor/unknown-model');
    const paths = specs.map((s) => s.path);
    expect(paths).toEqual(
      expect.arrayContaining(['provider.order', 'provider.only', 'provider.allow_fallbacks']),
    );
    expect(specs.every((s) => !s.path.startsWith('provider.') || s.clientOwnsRoot)).toBe(true);
    const other = await service.getSpecs('openai', 'api_key', 'gpt-4o');
    expect(other.some((s) => s.path.startsWith('provider.'))).toBe(false);
  });

  it('validate on save', async () => {
    const specs = await service.getSpecs('openrouter', 'api_key', 'x/y');
    expect(
      sanitizeModelParams(
        'openrouter',
        { provider: { order: ['deepinfra'], sort: 'throughput', max_price: { prompt: 1 } } },
        specs,
      ),
    ).toEqual({ provider: { order: ['deepinfra'], sort: 'throughput', max_price: { prompt: 1 } } });
    expect(() =>
      sanitizeModelParams('openrouter', { provider: { order: 'deepinfra' } }, specs),
    ).toThrow('Invalid value');
    expect(() =>
      sanitizeModelParams('openrouter', { provider: { sort: 'cheapest' } }, specs),
    ).toThrow('Invalid value');
  });
});
