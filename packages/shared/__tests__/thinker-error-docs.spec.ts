import { THINKER_ERRORS_DOCS_BASE, thinkerErrorDocsUrl } from '../src/thinker-error-docs';

describe('thinker error docs', () => {
  it('points at the public error documentation', () => {
    expect(THINKER_ERRORS_DOCS_BASE).toBe('https://github.com/patrickbrandao/thinker/blob/main/docs/erros.md');
  });

  it('deep links a code to its own page', () => {
    expect(thinkerErrorDocsUrl('M100')).toBe('https://github.com/patrickbrandao/thinker/blob/main/docs/erros.md#m100');
    expect(thinkerErrorDocsUrl('M300')).toBe('https://github.com/patrickbrandao/thinker/blob/main/docs/erros.md#m300');
  });
});
