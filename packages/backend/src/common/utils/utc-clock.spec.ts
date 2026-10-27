import {
  overriddenTimeZoneWarning,
  pinProcessTimeZoneToUtc,
  pinSessionTimeZoneToUtc,
} from './utc-clock';

describe('pinProcessTimeZoneToUtc', () => {
  it('forces TZ to UTC and reports a non-UTC zone the environment asked for', () => {
    const env: NodeJS.ProcessEnv = { TZ: 'America/Sao_Paulo' };
    expect(pinProcessTimeZoneToUtc(env)).toBe('America/Sao_Paulo');
    expect(env['TZ']).toBe('UTC');
  });

  it.each([undefined, '', 'UTC', 'Etc/UTC', 'utc', 'GMT', 'Etc/GMT', 'Zulu'])(
    'reports nothing for %p',
    (tz) => {
      const env: NodeJS.ProcessEnv = tz === undefined ? {} : { TZ: tz };
      expect(pinProcessTimeZoneToUtc(env)).toBeNull();
      expect(env['TZ']).toBe('UTC');
    },
  );
});

describe('overriddenTimeZoneWarning', () => {
  it('names the ignored zone', () => {
    expect(overriddenTimeZoneWarning('Europe/Lisbon')).toContain('TZ=Europe/Lisbon is ignored');
    expect(overriddenTimeZoneWarning(null)).toBeNull();
  });
});

describe('pinSessionTimeZoneToUtc', () => {
  it('sets the session time zone', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await pinSessionTimeZoneToUtc({ query });
    expect(query).toHaveBeenCalledWith("SET TIME ZONE 'UTC'");
  });
});
