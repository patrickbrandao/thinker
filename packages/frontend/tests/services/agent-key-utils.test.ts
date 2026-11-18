import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  daysFromNow,
  expiryFromDate,
  expiryInDays,
  isStaleKey,
} from '../../src/services/agent-key-utils';
import type { AgentKeyView } from '../../src/services/api/agent-keys';

const now = Date.parse('2026-11-18T12:00:00Z');
const ago = (days: number) => new Date(now - days * DAY_MS).toISOString();

const key = (over: Partial<AgentKeyView>): AgentKeyView => ({
  id: 'k1',
  name: 'ci',
  keyPrefix: 'thk_abcd',
  isPrimary: false,
  status: 'active',
  expiresAt: null,
  lastUsedAt: null,
  createdAt: ago(1),
  revokedAt: null,
  ...over,
});

describe('isStaleKey', () => {
  it('flags a key never used and created more than 90 days ago', () => {
    expect(isStaleKey(key({ createdAt: ago(91) }), now)).toBe(true);
    expect(isStaleKey(key({ createdAt: ago(89) }), now)).toBe(false);
  });

  it('flags a key last used more than 90 days ago', () => {
    expect(isStaleKey(key({ createdAt: ago(200), lastUsedAt: ago(95) }), now)).toBe(true);
    expect(isStaleKey(key({ createdAt: ago(200), lastUsedAt: ago(10) }), now)).toBe(false);
  });

  it('never flags revoked keys', () => {
    expect(isStaleKey(key({ createdAt: ago(200), status: 'revoked' }), now)).toBe(false);
  });
});

describe('expiry helpers', () => {
  it('computes preset expiries', () => {
    expect(expiryInDays(30, now)).toBe(new Date(now + 30 * DAY_MS).toISOString());
  });

  it('accepts custom dates after today and at most 365 days ahead', () => {
    const d = new Date(now + 10 * DAY_MS);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const iso = expiryFromDate(ymd, now);
    expect(iso).not.toBeNull();
    expect(Date.parse(iso!)).toBeGreaterThan(now);
    expect(expiryFromDate('2020-01-01', now)).toBeNull();
    expect(expiryFromDate('2028-01-01', now)).toBeNull();
    expect(expiryFromDate('bad', now)).toBeNull();
  });

  it('counts days from now', () => {
    expect(daysFromNow(new Date(now + 2.5 * DAY_MS).toISOString(), now)).toBe(3);
    expect(daysFromNow(ago(4), now)).toBe(-4);
  });
});
