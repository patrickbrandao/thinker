import { validStreamIdleOverride } from '../stream-writer';

describe('validStreamIdleOverride', () => {
  it('accepts whole milliseconds within 1 s and 1 h, else inherits', () => {
    expect(validStreamIdleOverride(600_000)).toBe(600_000);
    expect(validStreamIdleOverride(999)).toBeUndefined();
    expect(validStreamIdleOverride(3_600_001)).toBeUndefined();
    expect(validStreamIdleOverride(1.5e3 + 0.5)).toBeUndefined();
    expect(validStreamIdleOverride(null)).toBeUndefined();
  });
});
