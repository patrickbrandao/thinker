import {
  DEFAULT_RECORDING_RETENTION_DAYS,
  LEGACY_RECORDING_PREFIX,
  legacyRecordingEnvWarning,
  parseRecordingRetentionDays,
} from './recording-retention';

describe('parseRecordingRetentionDays', () => {
  it('defaults to 30 days when unset or blank', () => {
    expect(DEFAULT_RECORDING_RETENTION_DAYS).toBe(30);
    expect(parseRecordingRetentionDays(undefined)).toBe(30);
    expect(parseRecordingRetentionDays('')).toBe(30);
    expect(parseRecordingRetentionDays('  ')).toBe(30);
  });

  it('accepts a positive integer override', () => {
    expect(parseRecordingRetentionDays('7')).toBe(7);
    expect(parseRecordingRetentionDays(' 365 ')).toBe(365);
  });

  it.each(['0', '-1', '1.5', '7d', 'invalid', '9007199254740992'])(
    'rejects %s with a message naming the variable',
    (value) => {
      expect(() => parseRecordingRetentionDays(value)).toThrow(
        /THINKER_RECORDING_RETENTION_DAYS must be a positive integer/,
      );
    },
  );
});

describe('legacyRecordingEnvWarning', () => {
  it('is null when no legacy variable is set', () => {
    expect(legacyRecordingEnvWarning({ THINKER_RECORDING_STORAGE: 's3' })).toBeNull();
    expect(legacyRecordingEnvWarning({ [`${LEGACY_RECORDING_PREFIX}STORAGE`]: '' })).toBeNull();
  });

  it('names each legacy variable and its replacement, never the value', () => {
    const warning = legacyRecordingEnvWarning({
      [`${LEGACY_RECORDING_PREFIX}S3_SECRET_ACCESS_KEY`]: 'super-secret-value',
      [`${LEGACY_RECORDING_PREFIX}STORAGE`]: 's3',
    });
    expect(warning).toContain(
      `${LEGACY_RECORDING_PREFIX}S3_SECRET_ACCESS_KEY -> THINKER_RECORDING_S3_SECRET_ACCESS_KEY`,
    );
    expect(warning).toContain(`${LEGACY_RECORDING_PREFIX}STORAGE -> THINKER_RECORDING_STORAGE`);
    expect(warning).not.toContain('super-secret-value');
  });
});
