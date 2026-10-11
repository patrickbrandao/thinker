import {
  PLAYGROUND_BLOCKED_HEADERS,
  PLAYGROUND_BLOCKED_HEADER_PREFIXES,
  isPlaygroundHeaderBlocked,
} from '../src/playground-headers';

describe('isPlaygroundHeaderBlocked', () => {
  it.each([
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'api-key',
    'x-goog-api-key',
    'x-goog-user-project',
    'x-goog-iam-authorization-token',
    'ocp-apim-subscription-key',
    'cookie',
    'set-cookie',
    'openai-organization',
    'openai-project',
    'chatgpt-account-id',
    'session-id',
    'thread-id',
    'x-codex-turn-state',
  ])('blocks the credential or identity header %s', (name) => {
    expect(isPlaygroundHeaderBlocked(name)).toBe(true);
  });

  it.each([
    'host',
    'content-length',
    'content-type',
    'content-encoding',
    'connection',
    'keep-alive',
    'proxy-connection',
    'transfer-encoding',
    'upgrade',
    'te',
    'trailer',
    'expect',
    'forwarded',
    'x-real-ip',
  ])('blocks the transport or host-controlling header %s', (name) => {
    expect(isPlaygroundHeaderBlocked(name)).toBe(true);
  });

  it.each([
    'X-Thinker-Tier',
    'X-Manifest-Specificity',
    'X-Amz-Target',
    'X-Amz-Security-Token',
    'x-amzn-kiro-agent-mode',
    'X-Forwarded-Host',
    'x-forwarded-for',
  ])('blocks the prefixed header %s', (name) => {
    expect(isPlaygroundHeaderBlocked(name)).toBe(true);
  });

  it('compares case-insensitively and after trimming', () => {
    expect(isPlaygroundHeaderBlocked('X-API-KEY')).toBe(true);
    expect(isPlaygroundHeaderBlocked('  Authorization  ')).toBe(true);
    expect(isPlaygroundHeaderBlocked('\tX-Goog-Api-Key\n')).toBe(true);
    expect(isPlaygroundHeaderBlocked(' OpenAI-Organization')).toBe(true);
  });

  it.each([
    'X-Title',
    'HTTP-Referer',
    'anthropic-beta',
    'anthropic-version',
    'user-agent',
    'X-Request-Id',
    'x-api-keys-note',
    'x-goog-api-client',
  ])('keeps the ordinary header %s', (name) => {
    expect(isPlaygroundHeaderBlocked(name)).toBe(false);
  });

  it('treats an empty or blank name as not blocked (callers drop it separately)', () => {
    expect(isPlaygroundHeaderBlocked('')).toBe(false);
    expect(isPlaygroundHeaderBlocked('   ')).toBe(false);
  });

  it('keeps every list entry lower-case and trimmed so lookups match', () => {
    for (const name of [...PLAYGROUND_BLOCKED_HEADERS, ...PLAYGROUND_BLOCKED_HEADER_PREFIXES]) {
      expect(name).toBe(name.trim().toLowerCase());
    }
  });
});
