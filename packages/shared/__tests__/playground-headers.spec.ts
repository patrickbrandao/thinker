import {
  PLAYGROUND_BLOCKED_HEADERS,
  PLAYGROUND_BLOCKED_HEADER_PREFIXES,
  isPlaygroundHeaderBlocked,
  isPlaygroundHeaderNameValid,
  isPlaygroundHeaderValueValid,
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

  // Issue #105: changing either can hand the usage parser a body it cannot
  // read (non-SSE, or an encoding fetch does not decode).
  it.each(['accept', 'Accept', 'accept-encoding', ' Accept-Encoding '])(
    'blocks the response-negotiation header %j',
    (name) => {
      expect(isPlaygroundHeaderBlocked(name)).toBe(true);
    },
  );

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

describe('isPlaygroundHeaderNameValid', () => {
  it.each(['X-Title', 'x-custom_trace.1', "a!#$%&'*+.^_`|~z", '  X-Padded  '])(
    'accepts the RFC 9110 token %j',
    (name) => {
      expect(isPlaygroundHeaderNameValid(name)).toBe(true);
    },
  );

  it.each(['', '   ', 'X Bad', 'X-Bad:Colon', ':authority', 'X-Bad\r\nInjected', 'x-api-\u212Aey'])(
    'rejects %j',
    (name) => {
      expect(isPlaygroundHeaderNameValid(name)).toBe(false);
    },
  );
});

describe('isPlaygroundHeaderValueValid', () => {
  it('accepts exactly tab, U+0020-U+007E and U+0080-U+00FF', () => {
    const accepted: number[] = [];
    for (let code = 0; code <= 0x2ff; code++) {
      if (isPlaygroundHeaderValueValid(`a${String.fromCharCode(code)}b`)) accepted.push(code);
    }
    const expected = [0x09];
    for (let code = 0x20; code <= 0x7e; code++) expected.push(code);
    for (let code = 0x80; code <= 0xff; code++) expected.push(code);
    expect(accepted).toEqual(expected);
  });

  it('accepts an empty value', () => {
    expect(isPlaygroundHeaderValueValid('')).toBe(true);
  });

  it.each([
    ['CR LF', 'a\r\nX-Injected: 1'],
    ['NUL', 'a\0b'],
    ['DEL', 'a\x7fb'],
    ['euro sign', 'price \u20ac'],
    ['emoji', 'hi \u{1F600}'],
  ])('rejects a value containing %s', (_label, value) => {
    expect(isPlaygroundHeaderValueValid(value)).toBe(false);
  });
});
