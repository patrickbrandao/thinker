import { applyRequestParamDefaults } from '../src/request-params';
import { providerParamValueIsValid, type ProviderParamSpec } from '../src/provider-params-spec';

const spec = (path: string, type: ProviderParamSpec['type'], extra: Partial<ProviderParamSpec> = {}) =>
  ({
    provider: 'openrouter',
    authType: 'api_key',
    model: 'x/y',
    path,
    type,
    label: path,
    description: path,
    group: 'provider_routing',
    ...extra,
  }) as ProviderParamSpec;

describe('string_list params', () => {
  const s = spec('provider.order', 'string_list');
  it('accepts arrays of non-empty strings only', () => {
    expect(providerParamValueIsValid(s, ['deepinfra', 'together'])).toBe(true);
    expect(providerParamValueIsValid(s, [])).toBe(true);
    expect(providerParamValueIsValid(s, ['ok', ''])).toBe(false);
    expect(providerParamValueIsValid(s, 'deepinfra')).toBe(false);
    expect(providerParamValueIsValid(s, [1])).toBe(false);
  });
});

describe('clientOwnsRoot', () => {
  const specs = [
    spec('provider.order', 'string_list', { clientOwnsRoot: true }),
    spec('provider.allow_fallbacks', 'boolean', { clientOwnsRoot: true }),
    spec('temperature', 'number', { group: 'sampling' }),
  ];
  const route = { provider: { order: ['deepinfra'], allow_fallbacks: false }, temperature: 0.2 };

  it('injects the route object when the client sent none', () => {
    expect(applyRequestParamDefaults({ model: 'x/y' }, route, specs)).toEqual({
      model: 'x/y',
      provider: { order: ['deepinfra'], allow_fallbacks: false },
      temperature: 0.2,
    });
  });

  it("keeps the client's provider object whole, while other route params still apply", () => {
    expect(
      applyRequestParamDefaults({ model: 'x/y', provider: { sort: 'price' } }, route, specs),
    ).toEqual({ model: 'x/y', provider: { sort: 'price' }, temperature: 0.2 });
  });
});
