import {
  defaultAccountBaseUrl,
  normalizeAccountBaseUrl,
  supportsAccountBaseUrl,
} from './account-base-url';

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

  it('reports the official URL, region included', () => {
    expect(defaultAccountBaseUrl('openai', 'api_key', null)).toBe('https://api.openai.com');
    expect(defaultAccountBaseUrl('minimax', 'api_key', 'cn')).toContain('minimaxi.com');
    // The legacy shape: OpenCode's OpenAI-protocol base, Bedrock's Mantle host.
    expect(defaultAccountBaseUrl('opencode-go', 'api_key', null)).toBe(
      'https://opencode.ai/inference/go/openai',
    );
    expect(defaultAccountBaseUrl('bedrock', 'api_key', 'eu-west-1')).toContain('bedrock-mantle');
  });
});
