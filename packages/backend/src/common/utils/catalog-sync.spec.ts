import { isCatalogSyncEnabled } from './catalog-sync';

describe('isCatalogSyncEnabled', () => {
  it('is on by default (ADR 0003)', () => {
    expect(isCatalogSyncEnabled({})).toBe(true);
  });

  it.each(['false', 'FALSE', ' false ', '0', 'no', 'off'])('is off for %p', (value) => {
    expect(isCatalogSyncEnabled({ THINKER_CATALOG_SYNC: value })).toBe(false);
  });

  it.each(['true', '1', 'yes', 'on', ''])('stays on for %p', (value) => {
    expect(isCatalogSyncEnabled({ THINKER_CATALOG_SYNC: value })).toBe(true);
  });

  it('reads process.env when no env is passed', () => {
    const previous = process.env['THINKER_CATALOG_SYNC'];
    try {
      process.env['THINKER_CATALOG_SYNC'] = 'false';
      expect(isCatalogSyncEnabled()).toBe(false);
      delete process.env['THINKER_CATALOG_SYNC'];
      expect(isCatalogSyncEnabled()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env['THINKER_CATALOG_SYNC'];
      else process.env['THINKER_CATALOG_SYNC'] = previous;
    }
  });
});
