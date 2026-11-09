import {
  defaultAccountBaseUrl,
  normalizeAccountBaseUrl,
  rebaseUrl,
  supportsAccountBaseUrl,
} from './account-base-url';
import { resolveForwardEndpoint } from './proxy/forward-endpoint-resolver';

describe('account base URL', () => {
  it('applies only to API-key connections of built-in providers', () => {
    expect(supportsAccountBaseUrl('openai', 'api_key')).toBe(true);
    expect(supportsAccountBaseUrl('openai', undefined)).toBe(true);
    expect(supportsAccountBaseUrl('openai', 'subscription')).toBe(false);
    expect(supportsAccountBaseUrl('custom:abc', 'api_key')).toBe(false);
    expect(supportsAccountBaseUrl('ollama', 'local')).toBe(false);
    expect(supportsAccountBaseUrl('not-a-provider', 'api_key')).toBe(false);
  });

  it('normalizes and rejects bad shapes', () => {
    expect(normalizeAccountBaseUrl('  https://gw.example.com/openai/  ')).toBe(
      'https://gw.example.com/openai',
    );
    expect(normalizeAccountBaseUrl('')).toBeNull();
    expect(normalizeAccountBaseUrl(null)).toBeNull();
    expect(() => normalizeAccountBaseUrl('ftp://x')).toThrow('http');
    expect(() => normalizeAccountBaseUrl('https://u:p@x.com')).toThrow('credentials');
    expect(() => normalizeAccountBaseUrl('https://x.com/?a=1')).toThrow('query');
    expect(() => normalizeAccountBaseUrl('nope')).toThrow('valid');
  });

  it('wins over the built-in endpoint and keeps the API paths', () => {
    const { customEndpoint } = resolveForwardEndpoint({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-4o',
      providerBaseUrl: 'https://gw.example.com/v1',
    });
    expect(customEndpoint?.baseUrl).toBe('https://gw.example.com');
    expect(customEndpoint?.buildPath('gpt-4o')).toBe('/v1/chat/completions');
    expect(customEndpoint?.requiresSsrfRevalidation).toBe(true);
  });

  it('wins over the region', () => {
    const withRegion = resolveForwardEndpoint({
      provider: 'minimax',
      authType: 'api_key',
      model: 'MiniMax-M2',
      providerRegion: 'cn',
    });
    expect(withRegion.customEndpoint?.baseUrl).toContain('minimaxi.com');
    const overridden = resolveForwardEndpoint({
      provider: 'minimax',
      authType: 'api_key',
      model: 'MiniMax-M2',
      providerRegion: 'cn',
      providerBaseUrl: 'https://mirror.example.com',
    });
    expect(overridden.customEndpoint?.baseUrl).toBe('https://mirror.example.com');
  });

  it('is ignored without an override and for subscriptions', () => {
    expect(
      resolveForwardEndpoint({ provider: 'openai', authType: 'api_key', model: 'gpt-4o' })
        .customEndpoint,
    ).toBeUndefined();
    expect(
      resolveForwardEndpoint({
        provider: 'anthropic',
        authType: 'subscription',
        model: 'claude',
        providerBaseUrl: 'https://evil.example.com',
      }).customEndpoint,
    ).toBeUndefined();
  });

  it('reports the official URL, region included', () => {
    expect(defaultAccountBaseUrl('openai', 'api_key', null)).toBe('https://api.openai.com');
    expect(defaultAccountBaseUrl('minimax', 'api_key', 'cn')).toContain('minimaxi.com');
  });

  it('moves a models URL under the connection base', () => {
    expect(
      rebaseUrl(
        'https://api.openai.com/v1/models',
        'https://api.openai.com',
        'https://gw.example.com/openai/v1',
      ),
    ).toBe('https://gw.example.com/openai/v1/models');
    // A models URL on another host stays as is.
    expect(
      rebaseUrl('https://other.example.com/models', 'https://api.openai.com', 'https://x'),
    ).toBe('https://other.example.com/models');
  });
});
