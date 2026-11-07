import { describe, it, expect } from 'vitest';
import {
  groupChain,
  moveItem,
  newLine,
  validateLines,
} from '../../src/components/proxy/proxy-chain';

const P = (id: string) => newLine('proxy', [id]);
const D = newLine('direct');

describe('validateLines', () => {
  it('accepts an empty profile and valid lines', () => {
    expect(validateLines([])).toBeNull();
    expect(validateLines([P('a')])).toBeNull();
    expect(
      validateLines([newLine('affinity', ['a', 'c']), newLine('request', ['b', 'd']), D]),
    ).toBeNull();
  });

  it('rejects Direct first, more than 6 lines, empty lines and repeats', () => {
    expect(validateLines([D, P('a')])).toBe('firstNotProxy');
    expect(validateLines(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(P))).toBe('tooLong');
    expect(validateLines([newLine('affinity', [])])).toBe('emptyLine');
    expect(validateLines([newLine('affinity', ['a', 'b']), P('a')])).toBe('duplicateProxy');
    expect(validateLines([P('a'), D, P('b'), D])).toBe('duplicateDirect');
  });
});

describe('groupChain', () => {
  it('groups by line, one line per item without line numbers', () => {
    const item = (name: string, line?: number) => ({
      kind: 'proxy' as const,
      proxy_id: name,
      name,
      enabled: true,
      line,
    });
    expect(groupChain([item('a', 1), item('b', 1), item('c', 2)]).map((g) => g.length)).toEqual([
      2, 1,
    ]);
    expect(groupChain([item('a'), item('b')]).map((g) => g.length)).toEqual([1, 1]);
  });
});

describe('moveItem', () => {
  it('moves and clamps', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});
