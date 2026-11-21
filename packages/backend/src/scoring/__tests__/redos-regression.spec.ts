import { scoreRequest } from '../index';
import { computeSignalBoosts } from '../specificity-signals';
import { scoreConditionalLogic, scoreNestedListDepth } from '../dimensions/structural-dimensions';

// The scorer runs in the proxy's shared event loop. Before these patterns were
// bounded, 40k blank lines blocked the process for ~12 s and the time grew
// quadratically with the input. Every case below must stay well under a second.
const BUDGET_MS = 1000;

function timed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

const pathological: Array<[string, string]> = [
  ['blank lines', 'start of a long request\n' + '\n'.repeat(200_000)],
  ['indented blank lines', 'start\n' + ' \n'.repeat(100_000)],
  ['"if" without "then"', 'if '.repeat(100_000)],
  ['"when" without "happens"', 'when '.repeat(80_000)],
  ['hyphenated run', 'a-'.repeat(100_000)],
  ['one huge word', 'x'.repeat(500_000)],
  ['unclosed fences', '```\n'.repeat(50_000)],
];

describe('scoring regexes stay linear on pathological input', () => {
  it.each(pathological)('scoreRequest: %s', (_label, content) => {
    const ms = timed(() => scoreRequest({ messages: [{ role: 'user', content }] } as never));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it.each(pathological)('computeSignalBoosts: %s', (_label, content) => {
    expect(timed(() => computeSignalBoosts(content))).toBeLessThan(BUDGET_MS);
  });
});

describe('bounded patterns keep their meaning', () => {
  it('still counts indentation levels of nested lists', () => {
    const text = 'Plan:\n- a\n  - b\n    - c\n      1. d';
    expect(scoreNestedListDepth(text)).toBe(0.9);
  });

  it('no longer counts blank lines as indentation', () => {
    expect(scoreNestedListDepth('\n\n\n- item')).toBe(0);
  });

  it('still matches "if … then" on one line', () => {
    expect(scoreConditionalLogic('if the build fails then retry')).toBe(0.3);
  });

  it('still detects a bare host', () => {
    expect(computeSignalBoosts('open google.com please').boosts.get('web_browsing')).toBe(1);
  });
});
