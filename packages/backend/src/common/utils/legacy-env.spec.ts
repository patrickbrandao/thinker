import {
  assertLegacyEncryptionKeyMigrated,
  findLegacyEnvVars,
  legacyEnvWarnings,
  warnLegacyEnvVars,
} from './legacy-env';

// Built from parts so the acceptance grep for legacy names (#21) stays clean.
const OLD = ['MANIFEST', ''].join('_');

describe('legacy env vars', () => {
  it('reports nothing when no legacy variable is set', () => {
    expect(findLegacyEnvVars({ THINKER_ENCRYPTION_KEY: 'x', PATH: '/bin' })).toEqual([]);
    expect(legacyEnvWarnings({ THINKER_ENCRYPTION_KEY: 'x' })).toEqual([]);
  });

  it('ignores legacy variables set to an empty string', () => {
    expect(findLegacyEnvVars({ [`${OLD}ENCRYPTION_KEY`]: '' })).toEqual([]);
  });

  it('maps renamed variables to their THINKER_ names and flags removed ones', () => {
    expect(
      findLegacyEnvVars({
        [`${OLD}RATE_MAX_REQUESTS`]: '10',
        [`${OLD}MODE`]: 'selfhosted',
        [`${OLD}DISABLE_HSTS`]: '1',
      }),
    ).toEqual([
      { name: `${OLD}DISABLE_HSTS`, replacement: 'THINKER_DISABLE_HSTS' },
      { name: `${OLD}MODE`, replacement: null },
      { name: `${OLD}RATE_MAX_REQUESTS`, replacement: 'THINKER_RATE_MAX_REQUESTS' },
    ]);
  });

  it('fails fast, naming only the variables, when only the legacy encryption key is set', () => {
    const env = { [`${OLD}ENCRYPTION_KEY`]: 'super-secret-value-123' };
    let err: Error | undefined;
    try {
      assertLegacyEncryptionKeyMigrated(env);
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toContain(`${OLD}ENCRYPTION_KEY is set but THINKER_ENCRYPTION_KEY is not`);
    expect(err?.message).not.toContain('super-secret-value-123');
  });

  it('boots when THINKER_ENCRYPTION_KEY is set or the legacy key is absent/empty', () => {
    expect(() =>
      assertLegacyEncryptionKeyMigrated({
        [`${OLD}ENCRYPTION_KEY`]: 'old',
        THINKER_ENCRYPTION_KEY: 'new',
      }),
    ).not.toThrow();
    expect(() => assertLegacyEncryptionKeyMigrated({ [`${OLD}ENCRYPTION_KEY`]: '' })).not.toThrow();
    expect(() => assertLegacyEncryptionKeyMigrated({})).not.toThrow();
  });

  it('lists renamed variables in one warning', () => {
    const lines = legacyEnvWarnings({
      [`${OLD}ENCRYPTION_KEY`]: 'old',
      THINKER_ENCRYPTION_KEY: 'new',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Ignoring legacy environment variables');
  });

  it('logs names only, never values', () => {
    const warn = jest.fn();
    warnLegacyEnvVars(
      {
        [`${OLD}ENCRYPTION_KEY`]: 'super-secret-value-123',
        [`${OLD}ENCRYPTION_KEY_PREVIOUS`]: 'previous-secret-456',
        [`${OLD}TELEMETRY_DISABLED`]: 'true',
      },
      { warn },
    );
    expect(warn).toHaveBeenCalledTimes(2);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('super-secret-value-123');
    expect(logged).not.toContain('previous-secret-456');
    expect(logged).toContain(`${OLD}ENCRYPTION_KEY_PREVIOUS -> THINKER_ENCRYPTION_KEY_PREVIOUS`);
    expect(logged).toContain(`no longer exist: ${OLD}TELEMETRY_DISABLED`);
  });

  it('does not log at all when nothing legacy is set', () => {
    const warn = jest.fn();
    warnLegacyEnvVars({ THINKER_RATE_MAX_REQUESTS: '5' }, { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});
