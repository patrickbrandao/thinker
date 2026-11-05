import { BadRequestException } from '@nestjs/common';
import type { ProviderParamSpec } from 'thinker-shared';
import { sanitizeModelParams } from './sanitize-model-params';

const base = { provider: 'anthropic', authType: 'api_key' as const, model: 'claude-x' };

const specs: ProviderParamSpec[] = [
  {
    ...base,
    path: 'temperature',
    type: 'number',
    label: 'Temperature',
    description: 'Sampling temperature.',
    range: { min: 0, max: 2 },
    group: 'sampling',
  },
  {
    ...base,
    path: 'max_tokens',
    type: 'integer',
    label: 'Max tokens',
    description: 'Output cap.',
    range: { min: 1, max: 64000 },
    group: 'generation_length',
  },
  {
    ...base,
    path: 'reasoning_effort',
    type: 'enum',
    label: 'Effort',
    description: 'Reasoning effort.',
    values: ['low', 'medium', 'high'],
    group: 'reasoning',
  },
];

describe('sanitizeModelParams', () => {
  it('throws when the payload has no keys', () => {
    expect(() => sanitizeModelParams('anthropic', {}, specs)).toThrow(BadRequestException);
    expect(() => sanitizeModelParams('anthropic', {}, specs)).toThrow(
      'params must contain at least one configurable field',
    );
  });

  it('treats keys that are only undefined as empty', () => {
    expect(() =>
      sanitizeModelParams('anthropic', { temperature: undefined } as never, specs),
    ).toThrow('params must contain at least one configurable field');
  });

  it('throws when no key is compatible with the provider', () => {
    expect(() => sanitizeModelParams('anthropic', { top_k: 5 } as never, specs)).toThrow(
      'Provider "anthropic" does not consume any of the supplied params',
    );
  });

  it('throws when the provider catalog is empty', () => {
    expect(() => sanitizeModelParams('local', { temperature: 0.5 }, [])).toThrow(
      BadRequestException,
    );
  });

  it('keeps the compatible subset of a partially incompatible payload', () => {
    const out = sanitizeModelParams('anthropic', { temperature: 0.4, top_k: 5 } as never, specs);
    expect(out).toEqual({ temperature: 0.4 });
  });

  it('returns every compatible field', () => {
    const out = sanitizeModelParams(
      'anthropic',
      { temperature: 1, max_tokens: 1024, reasoning_effort: 'high' } as never,
      specs,
    );
    expect(out).toEqual({ temperature: 1, max_tokens: 1024, reasoning_effort: 'high' });
  });

  it('rejects an out-of-range number', () => {
    expect(() => sanitizeModelParams('anthropic', { temperature: 5 }, specs)).toThrow(
      'Invalid value for param "temperature"',
    );
  });

  it('rejects a non-integer for an integer param', () => {
    expect(() => sanitizeModelParams('anthropic', { max_tokens: 10.5 }, specs)).toThrow(
      'Invalid value for param "max_tokens"',
    );
  });

  it('rejects an enum value outside the allowed set', () => {
    expect(() =>
      sanitizeModelParams('anthropic', { reasoning_effort: 'extreme' } as never, specs),
    ).toThrow('Invalid value for param "reasoning_effort"');
  });

  it('rejects a wrongly typed value', () => {
    expect(() => sanitizeModelParams('anthropic', { temperature: '0.5' } as never, specs)).toThrow(
      BadRequestException,
    );
  });

  it('does not mutate the input', () => {
    const input = { temperature: 0.4, top_k: 5 } as never;
    sanitizeModelParams('anthropic', input, specs);
    expect(input).toEqual({ temperature: 0.4, top_k: 5 });
  });
});
