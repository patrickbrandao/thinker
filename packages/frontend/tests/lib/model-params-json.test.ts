import { describe, expect, it } from 'vitest';
import type { ProviderParamSpec } from 'thinker-shared';
import {
  addToStringList,
  advancedJsonText,
  advancedRoutingSpecs,
  parseAdvancedJson,
} from '../../src/lib/model-params-json';

const spec = (path: string, def: Partial<ProviderParamSpec>): ProviderParamSpec =>
  ({
    provider: 'openrouter',
    authType: 'api_key',
    model: 'x',
    path,
    label: path,
    description: '',
    group: 'provider_routing',
    clientOwnsRoot: true,
    type: 'boolean',
    ...def,
  }) as ProviderParamSpec;

const specs = [
  spec('provider.order', { type: 'string_list' }),
  spec('provider.require_parameters', { type: 'boolean' }),
  spec('provider.quantizations', { type: 'string_list' }),
  spec('provider.max_price.prompt', { type: 'number', range: { min: 0 } }),
  spec('provider.max_price.completion', { type: 'number', range: { min: 0 } }),
];
const advanced = advancedRoutingSpecs(specs);

describe('addToStringList', () => {
  it('splits on commas, trims and drops empty and duplicate items', () => {
    expect(addToStringList(['a'], ' b, ,a, c ')).toEqual(['a', 'b', 'c']);
  });

  it('caps the list at 64 items and each item at 120 chars', () => {
    const full = Array.from({ length: 64 }, (_, i) => `p${i}`);
    expect(addToStringList(full, 'extra')).toHaveLength(64);
    expect(addToStringList([], 'x'.repeat(200))[0]).toHaveLength(120);
  });
});

describe('advanced routing JSON', () => {
  it('keeps the basic fields out of the advanced box', () => {
    expect(advanced.map((s) => s.path)).not.toContain('provider.order');
  });

  it('serializes set values relative to the provider root', () => {
    const text = advancedJsonText(
      advanced,
      { provider: { order: ['a'], require_parameters: true, max_price: { prompt: 1 } } },
      () => true,
    );
    expect(JSON.parse(text)).toEqual({ require_parameters: true, max_price: { prompt: 1 } });
    expect(advancedJsonText(advanced, {}, () => false)).toBe('');
  });

  it('accepts empty text and valid nested keys', () => {
    expect(parseAdvancedJson('  ', advanced)).toEqual({ ok: true, values: new Map() });
    const result = parseAdvancedJson(
      '{"quantizations":["fp8"],"max_price":{"completion":0}}',
      advanced,
    );
    expect(result.ok && [...result.values]).toEqual([
      ['provider.quantizations', ['fp8']],
      ['provider.max_price.completion', 0],
    ]);
  });

  it.each([
    ['{', 'Invalid JSON.'],
    ['[]', 'Enter a JSON object.'],
    ['{"order":["a"]}', 'Unknown key "order".'],
    ['{"max_price":{"foo":1}}', 'Unknown key "max_price.foo".'],
    ['{"require_parameters":"yes"}', '"require_parameters" must be true or false.'],
    ['{"max_price":{"prompt":-1}}', '"max_price.prompt" must be a number ≥ 0.'],
    ['{"max_price":3}', '"max_price" must be an object.'],
    ['{"quantizations":["fp8",""]}', '"quantizations" must be a list of non-empty strings.'],
  ])('rejects %s', (text, error) => {
    expect(parseAdvancedJson(text, advanced)).toEqual({ ok: false, error });
  });
});
