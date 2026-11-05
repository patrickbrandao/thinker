import {
  buildAnthropicShortModelIdVariants,
  normalizeAnthropicShortModelId,
  normalizeProviderModel,
} from './anthropic-model-id';

describe('normalizeAnthropicShortModelId', () => {
  it.each([
    ['claude-sonnet-4.5', 'claude-sonnet-4-5'],
    ['claude-opus-4.1', 'claude-opus-4-1'],
    ['claude-haiku-4.5', 'claude-haiku-4-5'],
    ['claude-sonnet-4.5-20250929', 'claude-sonnet-4-5-20250929'],
    ['Claude-Sonnet-4.5', 'Claude-Sonnet-4-5'],
    ['anthropic/claude-sonnet-4.5', 'anthropic/claude-sonnet-4-5'],
    ['claude-opus-4.10', 'claude-opus-4-10'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeAnthropicShortModelId(input)).toBe(expected);
  });

  it.each([
    'claude-sonnet-4-5', // already dashed
    'claude-sonnet-4',
    'claude-3-5-sonnet', // legacy ordering, not a short id
    'claude-3.5-sonnet',
    'claude-sonnet-4.123', // minor is at most two digits
    'gpt-4.5',
    'gemini-2.5-pro',
    'anthropic/gpt-4.5',
    'sonnet-4.5',
    '',
  ])('leaves %p alone', (input) => {
    expect(normalizeAnthropicShortModelId(input)).toBe(input);
  });

  it('only rewrites a version at the end of the id or right before a YYYYMMDD date', () => {
    expect(normalizeAnthropicShortModelId('claude-sonnet-4.5-v1.0')).toBe('claude-sonnet-4.5-v1.0');
    expect(normalizeAnthropicShortModelId('claude-sonnet-4.5-latest')).toBe(
      'claude-sonnet-4.5-latest',
    );
  });
});

describe('buildAnthropicShortModelIdVariants', () => {
  it('lists the id as given, the dashed form and the dotted form', () => {
    expect(buildAnthropicShortModelIdVariants('claude-sonnet-4.5')).toEqual([
      'claude-sonnet-4.5',
      'claude-sonnet-4-5',
    ]);
    expect(buildAnthropicShortModelIdVariants('claude-sonnet-4-5')).toEqual([
      'claude-sonnet-4-5',
      'claude-sonnet-4.5',
    ]);
  });

  it('keeps the provider prefix on every variant', () => {
    expect(buildAnthropicShortModelIdVariants('anthropic/claude-haiku-4-5')).toEqual([
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-haiku-4.5',
    ]);
  });

  it('handles a dated suffix', () => {
    expect(buildAnthropicShortModelIdVariants('claude-opus-4.1-20250805')).toEqual([
      'claude-opus-4.1-20250805',
      'claude-opus-4-1-20250805',
    ]);
  });

  it('returns only the input for ids that are not short Claude ids', () => {
    expect(buildAnthropicShortModelIdVariants('gpt-4.5')).toEqual(['gpt-4.5']);
    expect(buildAnthropicShortModelIdVariants('claude-3-5-sonnet')).toEqual(['claude-3-5-sonnet']);
  });

  it('never repeats a variant', () => {
    const variants = buildAnthropicShortModelIdVariants('claude-sonnet-4');
    expect(new Set(variants).size).toBe(variants.length);
  });
});

describe('normalizeProviderModel', () => {
  it('normalizes only for Anthropic, in any letter case', () => {
    expect(normalizeProviderModel('anthropic', 'claude-sonnet-4.5')).toBe('claude-sonnet-4-5');
    expect(normalizeProviderModel('Anthropic', 'claude-sonnet-4.5')).toBe('claude-sonnet-4-5');
    expect(normalizeProviderModel('ANTHROPIC', 'claude-sonnet-4.5')).toBe('claude-sonnet-4-5');
  });

  it('leaves other providers untouched, even for a Claude-shaped id', () => {
    expect(normalizeProviderModel('openrouter', 'claude-sonnet-4.5')).toBe('claude-sonnet-4.5');
    expect(normalizeProviderModel('bedrock', 'anthropic/claude-sonnet-4.5')).toBe(
      'anthropic/claude-sonnet-4.5',
    );
  });
});
