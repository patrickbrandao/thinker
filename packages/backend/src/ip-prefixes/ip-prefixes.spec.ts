import { BadRequestException } from '@nestjs/common';
import { buildMatcher, normalizePrefix } from './ip-prefix-matcher';
import { parseEntries } from './ip-prefixes.service';
import { keyStatus, parseKeyExpiry, MAX_KEY_LIFETIME_DAYS } from '../otlp/services/api-key.service';

describe('IP prefix lists', () => {
  it('normalizes single addresses to /32 and /128 and keeps prefixes', () => {
    expect(normalizePrefix('203.0.113.7')).toBe('203.0.113.7/32');
    expect(normalizePrefix(' 203.0.113.0/24 ')).toBe('203.0.113.0/24');
    expect(normalizePrefix('2001:DB8::1')).toBe('2001:db8::1/128');
    expect(normalizePrefix('2001:db8::/48')).toBe('2001:db8::/48');
    expect(normalizePrefix('::ffff:198.51.100.1')).toBe('198.51.100.1/32');
  });

  it('rejects invalid entries', () => {
    for (const bad of [
      '',
      'example.com',
      '203.0.113.0/33',
      '2001:db8::/129',
      '1.2.3.4/x',
      '1.2.3.4/8/9',
    ]) {
      expect(normalizePrefix(bad)).toBeNull();
    }
    expect(() => parseEntries([{ prefix: 'nope' }])).toThrow(BadRequestException);
    expect(() => parseEntries('203.0.113.0/24')).toThrow(BadRequestException);
  });

  it('dedupes entries after normalization and keeps labels', () => {
    expect(
      parseEntries([
        { prefix: '203.0.113.7', label: ' office ' },
        { prefix: '203.0.113.7/32' },
        '2001:db8::/48',
      ]),
    ).toEqual([
      { prefix: '203.0.113.7/32', label: 'office' },
      { prefix: '2001:db8::/48', label: null },
    ]);
  });

  it('matches IPv4, IPv6 and IPv4-mapped clients', () => {
    const m = buildMatcher(['198.51.100.0/24', '2001:db8::/32']);
    expect(m.contains('198.51.100.200')).toBe(true);
    expect(m.contains('::ffff:198.51.100.1')).toBe(true);
    expect(m.contains('2001:db8:1::5')).toBe(true);
    expect(m.contains('203.0.113.1')).toBe(false);
    expect(m.contains('2001:db9::1')).toBe(false);
    expect(m.contains('garbage')).toBe(false);
    expect(buildMatcher([]).contains('198.51.100.1')).toBe(false);
  });
});

describe('harness key rules', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');

  it('requires a future expiry within the maximum lifetime', () => {
    expect(() => parseKeyExpiry(undefined, now)).toThrow('must expire');
    expect(() => parseKeyExpiry('soon', now)).toThrow('valid date');
    expect(() => parseKeyExpiry('2026-11-17T00:00:00Z', now)).toThrow('future');
    const tooFar = new Date(now + (MAX_KEY_LIFETIME_DAYS + 2) * 86_400_000).toISOString();
    expect(() => parseKeyExpiry(tooFar, now)).toThrow(`${MAX_KEY_LIFETIME_DAYS} days`);
    const ok = new Date(now + 30 * 86_400_000).toISOString();
    expect(parseKeyExpiry(ok, now).toISOString()).toBe(ok);
  });

  it('derives the status: revoked > expired > disabled/active', () => {
    const base = { is_active: true, revoked_at: null, expires_at: null };
    expect(keyStatus(base, now)).toBe('active');
    expect(keyStatus({ ...base, is_active: false }, now)).toBe('disabled');
    expect(keyStatus({ ...base, expires_at: '2026-11-01T00:00:00Z' }, now)).toBe('expired');
    expect(
      keyStatus(
        {
          is_active: false,
          revoked_at: '2026-11-02T00:00:00Z',
          expires_at: '2026-11-01T00:00:00Z',
        },
        now,
      ),
    ).toBe('revoked');
  });
});
