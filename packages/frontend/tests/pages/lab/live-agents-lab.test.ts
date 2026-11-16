import { afterEach, describe, expect, it } from 'vitest';
import { LAB_SETTINGS_KEY, loadSettings } from '../../../src/pages/lab/LiveAgentsLab';
import { withoutMaximize } from '../../../src/pages/lab/LiveAgentsWall';

afterEach(() => localStorage.clear());

describe('Live agents lab: no short view', () => {
  it('loads saved settings that still carry the old compact key', () => {
    localStorage.setItem(
      LAB_SETTINGS_KEY,
      JSON.stringify({ layout: { compact: true, tileHeight: 500, defaultTab: 'details' } }),
    );
    const s = loadSettings();
    expect(s.layout).not.toHaveProperty('compact');
    expect(s.layout.tileHeight).toBe(500);
    expect(s.layout.defaultTab).toBe('details');
  });

  it('drops mode and maximize from window prefs patches', () => {
    expect(withoutMaximize({ mode: 'compact', maximized: true, tab: 'chat' })).toEqual({
      tab: 'chat',
    });
    const same = { tab: 'inspector' as const };
    expect(withoutMaximize(same)).toBe(same);
  });
});
