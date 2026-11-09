import { DEFAULT_TIER_COLOR, TIER_COLORS, type TierColor } from '../src/tier-colors';
import * as barrel from '../src';

describe('TIER_COLORS', () => {
  it('has unique, lowercase, alphabetic names', () => {
    expect(new Set(TIER_COLORS).size).toBe(TIER_COLORS.length);
    for (const color of TIER_COLORS) expect(color).toMatch(/^[a-z]+$/);
  });

  it('contains the default color', () => {
    expect(TIER_COLORS).toContain(DEFAULT_TIER_COLOR);
    expect(DEFAULT_TIER_COLOR).toBe('indigo');
  });

  it('offers enough colors for every tier slot plus virtual models', () => {
    expect(TIER_COLORS.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps a stable order (the dashboard palette picker relies on it)', () => {
    expect(TIER_COLORS.slice(0, 4)).toEqual(['slate', 'gray', 'zinc', 'stone']);
    expect(TIER_COLORS[TIER_COLORS.length - 1]).toBe('navy');
  });

  it('is re-exported from the package barrel', () => {
    expect(barrel.TIER_COLORS).toBe(TIER_COLORS);
    expect(barrel.DEFAULT_TIER_COLOR).toBe(DEFAULT_TIER_COLOR);
  });

  it('types TierColor as the union of its entries', () => {
    const color: TierColor = 'rose';
    expect(TIER_COLORS.includes(color)).toBe(true);
  });
});
