import { normalizeMinimaxSubscriptionBaseUrl, normalizeProviderBaseUrl } from './provider-base-url';

describe('normalizeProviderBaseUrl', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://api.example.com///', 'https://api.example.com'],
    ['https://api.example.com/v1', 'https://api.example.com'],
    ['https://api.example.com/v1/', 'https://api.example.com'],
    ['https://api.example.com/api/v1', 'https://api.example.com/api'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeProviderBaseUrl(input)).toBe(expected);
  });

  it('only strips a trailing /v1 segment', () => {
    expect(normalizeProviderBaseUrl('https://api.example.com/v1/chat')).toBe(
      'https://api.example.com/v1/chat',
    );
    expect(normalizeProviderBaseUrl('https://api.example.com/v10')).toBe(
      'https://api.example.com/v10',
    );
  });

  it('returns an empty string for an empty input', () => {
    expect(normalizeProviderBaseUrl('')).toBe('');
  });
});

describe('normalizeMinimaxSubscriptionBaseUrl', () => {
  it.each([
    ['https://api.minimax.io/anthropic', 'https://api.minimax.io/anthropic/v1'],
    ['https://api.minimax.io/anthropic/', 'https://api.minimax.io/anthropic/v1'],
    ['https://api.minimax.io/anthropic/v1', 'https://api.minimax.io/anthropic/v1'],
    ['https://api.minimax.io/anthropic/v1/', 'https://api.minimax.io/anthropic/v1'],
    ['https://api.minimaxi.com/anthropic', 'https://api.minimaxi.com/anthropic/v1'],
    ['https://api.minimaxi.com/anthropic/v1', 'https://api.minimaxi.com/anthropic/v1'],
  ])('accepts the official endpoint %s', (input, expected) => {
    expect(normalizeMinimaxSubscriptionBaseUrl(input)).toBe(expected);
  });

  it('ignores query strings and fragments when matching', () => {
    expect(normalizeMinimaxSubscriptionBaseUrl('https://api.minimax.io/anthropic?x=1#frag')).toBe(
      'https://api.minimax.io/anthropic/v1',
    );
  });

  it('rejects plain http', () => {
    expect(normalizeMinimaxSubscriptionBaseUrl('http://api.minimax.io/anthropic')).toBeNull();
  });

  it('rejects URLs carrying credentials', () => {
    expect(
      normalizeMinimaxSubscriptionBaseUrl('https://user:pass@api.minimax.io/anthropic'),
    ).toBeNull();
    expect(normalizeMinimaxSubscriptionBaseUrl('https://user@api.minimax.io/anthropic')).toBeNull();
  });

  it.each([
    'https://evil.example.com/anthropic',
    'https://api.minimax.io.evil.example.com/anthropic',
    'https://api.minimax.io/other',
    'https://api.minimax.io:8443/anthropic',
    'https://api.minimax.io/anthropic/v2',
    'https://API.MINIMAX.IO/ANTHROPIC/v1/extra',
  ])('rejects the non-allow-listed endpoint %s', (input) => {
    expect(normalizeMinimaxSubscriptionBaseUrl(input)).toBeNull();
  });

  it('returns null for text that is not a URL', () => {
    expect(normalizeMinimaxSubscriptionBaseUrl('not a url')).toBeNull();
    expect(normalizeMinimaxSubscriptionBaseUrl('')).toBeNull();
  });

  it('treats the hostname case-insensitively (URL lowercases it)', () => {
    expect(normalizeMinimaxSubscriptionBaseUrl('https://API.MINIMAX.IO/anthropic')).toBe(
      'https://api.minimax.io/anthropic/v1',
    );
  });
});
