import { urlHost, topologyInterval, topologyMinutes } from './topology.service';

describe('topologyMinutes', () => {
  it('converts minutes, hours and days', () => {
    expect(topologyMinutes('1m')).toBe(1);
    expect(topologyMinutes('120m')).toBe(120);
    expect(topologyMinutes('24h')).toBe(24 * 60);
    expect(topologyMinutes('60d')).toBe(60 * 24 * 60);
  });

  it('refuses malformed or out-of-bounds ranges', () => {
    for (const range of ['', '0m', '121m', '25h', '61d', '7w', '01h', 'toString', '1.5h']) {
      expect(topologyMinutes(range)).toBeNull();
    }
  });
});

describe('topologyInterval', () => {
  it('takes two dates with the start first', () => {
    expect(topologyInterval('2026-11-03T00:00:00Z', '2026-11-03T12:30:15Z')).toEqual({
      from: new Date('2026-11-03T00:00:00Z'),
      to: new Date('2026-11-03T12:30:15Z'),
    });
  });

  it('refuses a missing, invalid or reversed pair', () => {
    expect(topologyInterval(undefined, '2026-11-03T00:00:00Z')).toBeUndefined();
    expect(topologyInterval('soon', '2026-11-03T00:00:00Z')).toBeUndefined();
    expect(topologyInterval('2026-11-03T12:00:00Z', '2026-11-03T00:00:00Z')).toBeUndefined();
  });
});

describe('urlHost', () => {
  it('keeps the host and a non-default port, lowercased', () => {
    expect(urlHost('https://API.anthropic.com/v1')).toBe('api.anthropic.com');
    expect(urlHost('http://192.168.0.10:11434/v1')).toBe('192.168.0.10:11434');
    expect(urlHost('https://opencode.ai:443/zen')).toBe('opencode.ai');
  });

  it('is null for an empty or malformed URL', () => {
    expect(urlHost(null)).toBeNull();
    expect(urlHost('not a url')).toBeNull();
  });
});
