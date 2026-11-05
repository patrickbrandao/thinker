import { DEFAULT_CONFIG } from './config';
import { checkFormalLogicOverride, estimateTotalTokens, hasWordBoundaryMatch } from './overrides';
import type { ScorerConfig } from './types';

describe('hasWordBoundaryMatch', () => {
  it('matches a whole word', () => {
    expect(hasWordBoundaryMatch('please prove it', 'prove')).toBe(true);
  });

  it('matches at the start and end of the text', () => {
    expect(hasWordBoundaryMatch('prove', 'prove')).toBe(true);
    expect(hasWordBoundaryMatch('prove it', 'prove')).toBe(true);
    expect(hasWordBoundaryMatch('please prove', 'prove')).toBe(true);
  });

  it('rejects a keyword embedded in a longer word', () => {
    expect(hasWordBoundaryMatch('this is improvement', 'prove')).toBe(false);
    expect(hasWordBoundaryMatch('proves it', 'prove')).toBe(false);
    expect(hasWordBoundaryMatch('different', 'iff')).toBe(false);
  });

  it('treats digits and underscores as word characters', () => {
    expect(hasWordBoundaryMatch('prove_it', 'prove')).toBe(false);
    expect(hasWordBoundaryMatch('prove2', 'prove')).toBe(false);
    expect(hasWordBoundaryMatch('2prove', 'prove')).toBe(false);
  });

  it('treats punctuation and whitespace as boundaries', () => {
    expect(hasWordBoundaryMatch('(prove)', 'prove')).toBe(true);
    expect(hasWordBoundaryMatch('prove, then', 'prove')).toBe(true);
    expect(hasWordBoundaryMatch('line\nprove\nline', 'prove')).toBe(true);
    expect(hasWordBoundaryMatch('a-prove-b', 'prove')).toBe(true);
  });

  it('finds a later occurrence after an embedded one', () => {
    expect(hasWordBoundaryMatch('improve then prove', 'prove')).toBe(true);
    expect(hasWordBoundaryMatch('improve then improved', 'prove')).toBe(false);
  });

  it('matches multi-word keywords', () => {
    expect(hasWordBoundaryMatch('x if and only if y', 'if and only if')).toBe(true);
    expect(hasWordBoundaryMatch('x if and only ify', 'if and only if')).toBe(false);
  });

  it('lowercases the keyword but expects lowercase text', () => {
    expect(hasWordBoundaryMatch('prove it', 'PROVE')).toBe(true);
  });

  it('returns false when the keyword is absent or the text is empty', () => {
    expect(hasWordBoundaryMatch('hello world', 'prove')).toBe(false);
    expect(hasWordBoundaryMatch('', 'prove')).toBe(false);
  });
});

describe('checkFormalLogicOverride', () => {
  it.each([
    'Prove that the square root of 2 is irrational',
    'PROVE THIS THEOREM',
    'show the proof by induction',
    'Is this statement true if and only if x > 0?',
    'derive the formula',
  ])('fires for %p', (text) => {
    expect(checkFormalLogicOverride(DEFAULT_CONFIG, text)).toBe(true);
  });

  it.each([
    'hello there',
    'improve the performance of this function',
    'what is the weather today',
    'a different approach',
  ])('does not fire for %p', (text) => {
    expect(checkFormalLogicOverride(DEFAULT_CONFIG, text)).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(checkFormalLogicOverride(DEFAULT_CONFIG, '')).toBe(false);
  });

  it('returns false when the config has no formalLogic dimension', () => {
    const config: ScorerConfig = {
      ...DEFAULT_CONFIG,
      dimensions: DEFAULT_CONFIG.dimensions.filter((d) => d.name !== 'formalLogic'),
    };
    expect(checkFormalLogicOverride(config, 'prove this theorem')).toBe(false);
  });

  it('returns false when the formalLogic dimension has no keywords', () => {
    const config: ScorerConfig = {
      ...DEFAULT_CONFIG,
      dimensions: DEFAULT_CONFIG.dimensions.map((d) =>
        d.name === 'formalLogic' ? { ...d, keywords: undefined } : d,
      ),
    };
    expect(checkFormalLogicOverride(config, 'prove this theorem')).toBe(false);
  });

  it('honours a custom keyword list', () => {
    const config: ScorerConfig = {
      ...DEFAULT_CONFIG,
      dimensions: DEFAULT_CONFIG.dimensions.map((d) =>
        d.name === 'formalLogic' ? { ...d, keywords: ['Zebra'] } : d,
      ),
    };
    expect(checkFormalLogicOverride(config, 'a zebra crossing')).toBe(true);
    expect(checkFormalLogicOverride(config, 'prove this theorem')).toBe(false);
  });
});

describe('estimateTotalTokens', () => {
  it('returns 0 for no messages', () => {
    expect(estimateTotalTokens([])).toBe(0);
  });

  it('estimates one token per four characters of string content', () => {
    expect(estimateTotalTokens([{ role: 'user', content: 'x'.repeat(40) }])).toBe(10);
  });

  it('sums across messages', () => {
    expect(
      estimateTotalTokens([
        { role: 'user', content: 'x'.repeat(8) },
        { role: 'assistant', content: 'y'.repeat(12) },
      ]),
    ).toBe(5);
  });

  it('counts only the text of content blocks', () => {
    expect(
      estimateTotalTokens([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'x'.repeat(16) },
            { type: 'image_url', image_url: { url: 'data:...' } },
            null,
            { type: 'text', text: 42 },
          ] as never,
        },
      ]),
    ).toBe(4);
  });

  it('skips null and undefined content', () => {
    expect(
      estimateTotalTokens([
        { role: 'assistant', content: null },
        { role: 'assistant', content: undefined },
        { role: 'user', content: 'x'.repeat(4) },
      ] as never),
    ).toBe(1);
  });

  it('stringifies other content shapes', () => {
    expect(estimateTotalTokens([{ role: 'user', content: 12345678 } as never])).toBe(2);
  });
});
