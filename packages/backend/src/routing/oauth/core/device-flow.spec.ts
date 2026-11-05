import {
  ABSOLUTE_TIME_THRESHOLD_MS,
  toAbsoluteExpiryTimestamp,
  toPollIntervalMs,
} from './device-flow';

describe('toAbsoluteExpiryTimestamp', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('treats small values as relative seconds', () => {
    expect(toAbsoluteExpiryTimestamp(600)).toBe(Date.now() + 600_000);
  });

  it('keeps an absolute epoch-ms timestamp unchanged', () => {
    const absolute = Date.now() + 900_000;
    expect(absolute).toBeGreaterThan(ABSOLUTE_TIME_THRESHOLD_MS);
    expect(toAbsoluteExpiryTimestamp(absolute)).toBe(absolute);
  });

  it('treats the threshold itself as relative seconds', () => {
    expect(toAbsoluteExpiryTimestamp(ABSOLUTE_TIME_THRESHOLD_MS)).toBe(
      Date.now() + ABSOLUTE_TIME_THRESHOLD_MS * 1000,
    );
  });

  it('returns now for zero', () => {
    expect(toAbsoluteExpiryTimestamp(0)).toBe(Date.now());
  });
});

describe('toPollIntervalMs', () => {
  it('uses the default for a missing, zero or negative interval', () => {
    expect(toPollIntervalMs(undefined, 5000)).toBe(5000);
    expect(toPollIntervalMs(0, 5000)).toBe(5000);
    expect(toPollIntervalMs(-3, 5000)).toBe(5000);
    expect(toPollIntervalMs(Number.NaN, 5000)).toBe(5000);
  });

  it('converts seconds to milliseconds', () => {
    expect(toPollIntervalMs(5, 1000)).toBe(5000);
    expect(toPollIntervalMs(0.5, 1000)).toBe(500);
    expect(toPollIntervalMs(999, 1000)).toBe(999_000);
  });

  it('keeps values that are already milliseconds', () => {
    expect(toPollIntervalMs(1000, 5000)).toBe(1000);
    expect(toPollIntervalMs(2500, 5000)).toBe(2500);
  });
});
