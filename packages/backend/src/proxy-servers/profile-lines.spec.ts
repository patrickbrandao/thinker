import {
  groupLines,
  linesFromChain,
  rewriteLines,
  validateLines,
  type ProfileLine,
} from './profile-lines';

const known = new Set(['a', 'b', 'c', 'd']);
const P = (id: string): ProfileLine => ({
  mode: 'proxy',
  proxies: [id],
  on_failure: 'next_member',
  no_session: 'request',
});
const D: ProfileLine = {
  mode: 'direct',
  proxies: [],
  on_failure: 'next_member',
  no_session: 'request',
};
const G = (mode: 'affinity' | 'request', ...ids: string[]): ProfileLine => ({
  mode,
  proxies: ids,
  on_failure: 'next_member',
  no_session: 'request',
});
const chain = (items: Array<string | null>) =>
  validateLines(linesFromChain(items.map((i) => i ?? 'direct')), known);

describe('validateLines', () => {
  it('accepts the legacy chain: a proxy first, then proxies and one Direct', () => {
    expect(chain(['a', null, 'b'])).toEqual([P('a'), D, P('b')]);
    expect(chain([])).toEqual([]);
  });

  it('accepts balanced lines with options and defaults', () => {
    expect(
      validateLines(
        [
          { mode: 'affinity', proxies: ['a', 'c'], no_session: 'agent' },
          { mode: 'request', proxies: ['b', 'd'], on_failure: 'next_line' },
          { mode: 'direct' },
        ],
        known,
      ),
    ).toEqual([
      { mode: 'affinity', proxies: ['a', 'c'], on_failure: 'next_member', no_session: 'agent' },
      { mode: 'request', proxies: ['b', 'd'], on_failure: 'next_line', no_session: 'request' },
      D,
    ]);
  });

  it('turns a balanced line with one proxy into a proxy line', () => {
    expect(validateLines([{ mode: 'request', proxies: ['a'] }], known)).toEqual([P('a')]);
  });

  it('rejects Direct first or twice, repeats across lines, unknown ids and more than 6 lines', () => {
    expect(() => chain([null, 'a'])).toThrow();
    expect(() => chain(['a', null, null])).toThrow();
    expect(() => chain(['a', 'a'])).toThrow();
    expect(() => chain(['zzz'])).toThrow();
    expect(() =>
      validateLines(
        [
          { mode: 'affinity', proxies: ['a', 'b'] },
          { mode: 'request', proxies: ['b', 'c'] },
        ],
        known,
      ),
    ).toThrow();
    expect(() => validateLines([{ mode: 'proxy', proxies: ['a', 'b'] }], known)).toThrow();
    expect(() => validateLines([{ mode: 'affinity', proxies: [] }], known)).toThrow();
    expect(() =>
      validateLines([{ mode: 'affinity', proxies: ['a', 'b'], on_failure: 'x' }], known),
    ).toThrow();
    expect(() => chain(['a', 'b', 'c', null, 'd', 'a', 'b'])).toThrow();
  });
});

describe('rewriteLines', () => {
  it('removes the proxy and keeps the order', () => {
    expect(rewriteLines([P('a'), P('b'), D], 'b', null)).toEqual([P('a'), D]);
  });

  it('drops the whole profile when no proxy is left', () => {
    expect(rewriteLines([P('a')], 'a', null)).toBeNull();
    expect(rewriteLines([P('a'), D], 'a', null)).toBeNull();
  });

  it('keeps a proxy first when the removed one was first', () => {
    expect(rewriteLines([P('a'), D, P('b')], 'a', null)).toEqual([P('b'), D]);
  });

  it('replaces in place and drops the substitute when it is already in the profile', () => {
    expect(rewriteLines([P('a'), P('b')], 'a', 'c')).toEqual([P('c'), P('b')]);
    expect(rewriteLines([P('a'), P('b'), D], 'a', 'b')).toEqual([P('b'), D]);
  });

  it('shrinks balanced lines: one member left becomes a proxy line', () => {
    expect(rewriteLines([G('affinity', 'a', 'b', 'c'), D], 'b', null)).toEqual([
      G('affinity', 'a', 'c'),
      D,
    ]);
    expect(rewriteLines([G('affinity', 'a', 'b'), D], 'b', null)).toEqual([P('a'), D]);
    expect(rewriteLines([G('request', 'a', 'b')], 'a', 'd')).toEqual([G('request', 'd', 'b')]);
  });
});

describe('groupLines', () => {
  it('groups bindings by line with their settings; legacy rows are one line each', () => {
    expect(
      groupLines([
        {
          line: 1,
          position: 1,
          proxy_id: 'a',
          mode: 'affinity',
          on_failure: 'next_line',
          no_session: 'first',
        },
        {
          line: 1,
          position: 2,
          proxy_id: 'c',
          mode: 'affinity',
          on_failure: 'next_line',
          no_session: 'first',
        },
        { line: 2, position: 3, proxy_id: null, mode: 'direct' },
      ]),
    ).toEqual([
      { mode: 'affinity', proxies: ['a', 'c'], on_failure: 'next_line', no_session: 'first' },
      D,
    ]);
    expect(
      groupLines([
        { line: null, position: 2, proxy_id: null },
        { line: null, position: 1, proxy_id: 'a' },
      ]),
    ).toEqual([P('a'), D]);
  });
});
