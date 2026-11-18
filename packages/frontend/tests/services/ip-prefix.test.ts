import { describe, expect, it } from 'vitest';
import { formatPrefixLines, isValidPrefix, parsePrefixLines } from '../../src/services/ip-prefix';

describe('isValidPrefix', () => {
  it.each([
    '203.0.113.7',
    '203.0.113.0/24',
    '0.0.0.0/0',
    '10.0.0.1/32',
    '2001:db8::/48',
    '::1',
    '::',
    '::/0',
    '2001:db8:0:0:0:0:0:1/128',
    '::ffff:192.0.2.1',
    'fe80::1',
  ])('accepts %s', (v) => expect(isValidPrefix(v)).toBe(true));

  it.each([
    '',
    '256.0.0.1',
    '1.2.3',
    '1.2.3.4/33',
    '01.2.3.4',
    '2001:db8::/129',
    '2001:db8::1::2',
    '1:2:3:4:5:6:7:8:9',
    ':1:2',
    '1::2:',
    'example.com',
    '1.2.3.4/24/1',
    '1.2.3.4/x',
  ])('rejects %s', (v) => expect(isValidPrefix(v)).toBe(false));
});

describe('parsePrefixLines', () => {
  it('reads one prefix per line with an optional label after a space or #', () => {
    const text = [
      '# office networks',
      '203.0.113.0/24 office',
      '',
      '  2001:db8::/48 # VPN pool ',
      '198.51.100.7',
      '10.0.0.1#gateway',
      'nope label',
    ].join('\n');
    expect(parsePrefixLines(text)).toEqual([
      { line: 2, prefix: '203.0.113.0/24', label: 'office', valid: true },
      { line: 4, prefix: '2001:db8::/48', label: 'VPN pool', valid: true },
      { line: 5, prefix: '198.51.100.7', label: null, valid: true },
      { line: 6, prefix: '10.0.0.1', label: 'gateway', valid: true },
      { line: 7, prefix: 'nope', label: 'label', valid: false },
    ]);
  });

  it('round-trips through formatPrefixLines', () => {
    const entries = [
      { prefix: '203.0.113.0/24', label: 'office' },
      { prefix: '::1', label: null },
    ];
    const parsed = parsePrefixLines(formatPrefixLines(entries));
    expect(parsed.map(({ prefix, label }) => ({ prefix, label }))).toEqual(entries);
  });
});
