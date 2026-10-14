import {
  catalogSyncBootWarning,
  describeCatalogSyncSetting,
  isCatalogSyncEnabled,
  isCatalogSyncValueUnrecognized,
} from './catalog-sync';

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

describe('isCatalogSyncValueUnrecognized / catalogSyncBootWarning (#75)', () => {
  it.each([undefined, '', 'true', '1', 'yes', 'on', 'false', ' OFF ', '0', 'no'])(
    'accepts %p without a warning',
    (value) => {
      const env = value === undefined ? {} : { THINKER_CATALOG_SYNC: value };
      expect(isCatalogSyncValueUnrecognized(env)).toBe(false);
      expect(catalogSyncBootWarning(env)).toBeNull();
    },
  );

  it.each(['disabled', 'flase', 'nope', 'sk-secret-value'])(
    'warns for %p without echoing it, and keeps sync on',
    (value) => {
      const env = { THINKER_CATALOG_SYNC: value };
      expect(isCatalogSyncEnabled(env)).toBe(true);
      expect(isCatalogSyncValueUnrecognized(env)).toBe(true);
      const warning = catalogSyncBootWarning(env);
      expect(warning).toContain('THINKER_CATALOG_SYNC has an unrecognized value');
      expect(warning).toContain('false, 0, no, off');
      expect(warning).not.toContain(value);
    },
  );
});

describe('describeCatalogSyncSetting (#75)', () => {
  it.each([
    ['false', 'THINKER_CATALOG_SYNC=false'],
    ['0', 'THINKER_CATALOG_SYNC=0'],
    [' off ', 'THINKER_CATALOG_SYNC=off'],
    ['NO', 'THINKER_CATALOG_SYNC=NO'],
  ])('shows the configured off value %p', (value, expected) => {
    expect(describeCatalogSyncSetting({ THINKER_CATALOG_SYNC: value })).toBe(expected);
  });

  it('never echoes a value that is not a known off value', () => {
    expect(describeCatalogSyncSetting({ THINKER_CATALOG_SYNC: 'secret' })).toBe(
      'THINKER_CATALOG_SYNC=false',
    );
    expect(describeCatalogSyncSetting({})).toBe('THINKER_CATALOG_SYNC=false');
  });
});
