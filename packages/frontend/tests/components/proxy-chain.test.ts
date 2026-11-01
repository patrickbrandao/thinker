import { describe, it, expect } from 'vitest';
import { moveItem, validateChain } from '../../src/components/proxy/proxy-chain';

describe('validateChain', () => {
  it('accepts an empty chain and valid chains', () => {
    expect(validateChain([])).toBeNull();
    expect(validateChain(['a'])).toBeNull();
    expect(validateChain(['a', 'direct', 'b'])).toBeNull();
    expect(validateChain(['a', 'b', 'c', 'd', 'e', 'direct'])).toBeNull();
  });

  it('rejects a chain that starts with Direct', () => {
    expect(validateChain(['direct', 'a'])).toBe('firstNotProxy');
  });

  it('rejects more than 6 items', () => {
    expect(validateChain(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('tooLong');
  });

  it('rejects a repeated proxy or Direct twice', () => {
    expect(validateChain(['a', 'b', 'a'])).toBe('duplicateProxy');
    expect(validateChain(['a', 'direct', 'b', 'direct'])).toBe('duplicateDirect');
  });
});

describe('moveItem', () => {
  it('moves and clamps', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});
