import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  costLabel,
  isActive,
  shortId,
  spanLabel,
} from '../../../src/pages/sessions/session-format';

const at = (ms: number) => new Date(1_700_000_000_000 + ms).toISOString();
const base = at(0);

describe('spanLabel', () => {
  it('shows seconds under a minute', () => {
    expect(spanLabel(base, base)).toBe('0s');
    expect(spanLabel(base, at(45_000))).toBe('45s');
    expect(spanLabel(base, at(59_400))).toBe('59s');
  });

  it('rounds sub-minute spans to the nearest second', () => {
    expect(spanLabel(base, at(1_600))).toBe('2s');
  });

  it('shows whole minutes under an hour', () => {
    expect(spanLabel(base, at(60_000))).toBe('1m');
    expect(spanLabel(base, at(12 * 60_000 + 59_000))).toBe('12m');
    expect(spanLabel(base, at(59 * 60_000))).toBe('59m');
  });

  it('shows hours and minutes under a day', () => {
    expect(spanLabel(base, at(60 * 60_000))).toBe('1h 0m');
    expect(spanLabel(base, at((2 * 60 + 14) * 60_000))).toBe('2h 14m');
    expect(spanLabel(base, at((23 * 60 + 59) * 60_000))).toBe('23h 59m');
  });

  it('shows days and hours from a day on', () => {
    expect(spanLabel(base, at(24 * 3_600_000))).toBe('1d 0h');
    expect(spanLabel(base, at((3 * 24 + 5) * 3_600_000))).toBe('3d 5h');
  });

  it('clamps a negative span (clock skew) to 0s', () => {
    expect(spanLabel(at(10_000), base)).toBe('0s');
  });
});

describe('isActive', () => {
  afterEach(() => vi.useRealTimers());

  it('is live within five minutes of the last activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    expect(isActive(new Date(1_700_000_000_000 - 4 * 60_000 - 59_000).toISOString())).toBe(true);
    expect(isActive(new Date(1_700_000_000_000).toISOString())).toBe(true);
  });

  it('is not live at or past five minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    expect(isActive(new Date(1_700_000_000_000 - 5 * 60_000).toISOString())).toBe(false);
    expect(isActive(new Date(1_700_000_000_000 - 60 * 60_000).toISOString())).toBe(false);
  });

  it('is not live for an unparseable timestamp', () => {
    expect(isActive('not a date')).toBe(false);
  });
});

describe('costLabel', () => {
  it('formats dollars with two decimals', () => {
    expect(costLabel(12.345)).toBe('$12.35');
    expect(costLabel(0)).toBe('$0.00');
  });

  it('shows a floor for sub-cent costs', () => {
    expect(costLabel(0.004)).toBe('< $0.01');
  });

  it('shows a dash for an invalid or negative cost', () => {
    expect(costLabel(-1)).toBe('—');
    expect(costLabel(Number.NaN)).toBe('—');
    expect(costLabel(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('shortId', () => {
  it('keeps ids up to 22 characters intact', () => {
    expect(shortId('abc')).toBe('abc');
    expect(shortId('a'.repeat(22))).toBe('a'.repeat(22));
    expect(shortId('')).toBe('');
  });

  it('elides the middle of long ids, keeping 12 leading and 6 trailing characters', () => {
    expect(shortId('ses_e7fb03c66ffdoZ2E7CHux6fAfO')).toBe('ses_e7fb03c6…x6fAfO');
    expect(shortId('a'.repeat(23))).toBe('a'.repeat(12) + '…' + 'a'.repeat(6));
  });
});
