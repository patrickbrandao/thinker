import { describe, expect, it } from 'vitest';
import { searchMatcher } from '../../src/components/ModelPickerModal';

describe('searchMatcher', () => {
  it('returns null for an empty search', () => {
    expect(searchMatcher('   ')).toBeNull();
  });

  it('matches regular expressions, case-insensitive', () => {
    const m = searchMatcher('^gpt-5|flash$')!;
    expect(m('GPT-5.1')).toBe(true);
    expect(m('DeepSeek V4 Flash')).toBe(true);
    expect(m('my-gpt-5')).toBe(false);
  });

  it('falls back to a substring match when the expression is invalid', () => {
    const m = searchMatcher('gpt(')!;
    expect(m('model gpt(beta)')).toBe(true);
    expect(m('gpt-5')).toBe(false);
  });
});
