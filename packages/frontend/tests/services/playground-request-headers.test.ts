import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_REQUEST_HEADERS_STORAGE_KEY,
  MAX_PERSISTED_NAME_LENGTH,
  REQUEST_HEADER_NAMES_STORAGE_KEY,
  activeHeaderCount,
  blankEntry,
  cleanUpStoredHeaders,
  headerEntryIssue,
  headerValueIssue,
  isBlockedHeaderKey,
  isValidHeaderName,
  loadStoredHeaderEntries,
  persistHeaderNames,
  toHeaderRecord,
} from '../../src/services/playground-request-headers';

describe('isBlockedHeaderKey', () => {
  it('flags Thinker-managed and transport-layer headers case-insensitively', () => {
    expect(isBlockedHeaderKey('Authorization')).toBe(true);
    expect(isBlockedHeaderKey('cookie')).toBe(true);
    expect(isBlockedHeaderKey('Content-Type')).toBe(true);
    expect(isBlockedHeaderKey('X-Thinker-Trace')).toBe(true);
  });

  // Issue #64: the dashboard warns on the same credential headers the server drops.
  it('flags provider credential and tenant-identity headers', () => {
    expect(isBlockedHeaderKey('X-API-Key')).toBe(true);
    expect(isBlockedHeaderKey(' x-goog-api-key ')).toBe(true);
    expect(isBlockedHeaderKey('api-key')).toBe(true);
    expect(isBlockedHeaderKey('OpenAI-Organization')).toBe(true);
    expect(isBlockedHeaderKey('ChatGPT-Account-Id')).toBe(true);
  });

  it('lets normal provider headers through', () => {
    expect(isBlockedHeaderKey('HTTP-Referer')).toBe(false);
    expect(isBlockedHeaderKey('X-Title')).toBe(false);
    expect(isBlockedHeaderKey('anthropic-beta')).toBe(false);
  });

  it('treats empty / whitespace as not blocked so the warning does not flash on new rows', () => {
    expect(isBlockedHeaderKey('')).toBe(false);
    expect(isBlockedHeaderKey('   ')).toBe(false);
  });
});

describe('isValidHeaderName', () => {
  it('accepts RFC 9110 tokens, ignoring surrounding whitespace', () => {
    expect(isValidHeaderName('X-Title')).toBe(true);
    expect(isValidHeaderName(" x.custom_header!#$%&'*+^`|~ ")).toBe(true);
  });

  it('rejects empty names, spaces, separators and non-ASCII', () => {
    expect(isValidHeaderName('')).toBe(false);
    expect(isValidHeaderName('X Title')).toBe(false);
    expect(isValidHeaderName('X-Title:')).toBe(false);
    expect(isValidHeaderName('X(Title)')).toBe(false);
    expect(isValidHeaderName('X-Título')).toBe(false);
    expect(isValidHeaderName('X-Title\n')).toBe(true); // trimmed, like the server
    expect(isValidHeaderName('X-\nTitle')).toBe(false);
  });
});

describe('headerValueIssue', () => {
  it('accepts printable ASCII, tabs and Latin-1', () => {
    expect(headerValueIssue('https://example.com/?a=1')).toBeNull();
    expect(headerValueIssue('a\tb')).toBeNull();
    expect(headerValueIssue('café ÿ')).toBeNull();
    expect(headerValueIssue('')).toBeNull();
  });

  it('flags C0 control characters and DEL', () => {
    for (const ch of ['\0', '\u0001', '\n', '\r', '\u001b', '\u007f']) {
      expect(headerValueIssue(`a${ch}b`)).toBe('control-chars');
    }
  });

  it('flags characters above U+00FF, including emoji', () => {
    expect(headerValueIssue('Ā')).toBe('unsupported-chars');
    expect(headerValueIssue('中文')).toBe('unsupported-chars');
    expect(headerValueIssue('\u{1F680}')).toBe('unsupported-chars');
  });
});

describe('headerEntryIssue', () => {
  it('reports nothing for a blank or valid row', () => {
    expect(headerEntryIssue({ key: '', value: '' })).toBeNull();
    expect(headerEntryIssue({ key: '  ', value: '\n' })).toBeNull();
    expect(headerEntryIssue({ key: 'X-Title', value: 'ok' })).toBeNull();
  });

  it('reports the name problem before the value problem', () => {
    expect(headerEntryIssue({ key: 'X Title', value: '\n' })).toBe('invalid-name');
    expect(headerEntryIssue({ key: 'Authorization', value: '\n' })).toBe('blocked');
    expect(headerEntryIssue({ key: 'X-Title', value: '\n' })).toBe('control-chars');
    expect(headerEntryIssue({ key: 'X-Title', value: '\u{1F680}' })).toBe('unsupported-chars');
  });
});

describe('toHeaderRecord / activeHeaderCount', () => {
  const entries = [
    { id: '1', key: 'HTTP-Referer', value: 'https://x' },
    { id: '2', key: 'Authorization', value: 'Bearer' },
    { id: '3', key: '', value: 'orphan' },
    { id: '4', key: 'X-Empty', value: '' },
    { id: '5', key: ' X-Title ', value: 'Trimmed' },
    { id: '6', key: 'X Bad', value: 'v' },
    { id: '7', key: 'X-Ctl', value: 'a\r\nInjected: 1' },
    { id: '8', key: 'X-Emoji', value: '\u{1F680}' },
  ];

  it('keeps only the headers the server would forward', () => {
    expect(toHeaderRecord(entries)).toEqual({
      'HTTP-Referer': 'https://x',
      'X-Title': 'Trimmed',
    });
  });

  it('counts only forwarded headers', () => {
    expect(activeHeaderCount(entries)).toBe(2);
    expect(activeHeaderCount([])).toBe(0);
  });

  // Same rule as the server sanitizer: case-insensitive, first occurrence wins.
  it('keeps only the first of case-variant duplicates', () => {
    const dupes = [
      { id: '1', key: 'X-Title', value: 'first' },
      { id: '2', key: 'x-title', value: 'second' },
      { id: '3', key: ' X-TITLE ', value: 'third' },
    ];
    expect(toHeaderRecord(dupes)).toEqual({ 'X-Title': 'first' });
    expect(activeHeaderCount(dupes)).toBe(1);
  });

  it('skips dropped rows before de-duplicating, like the server', () => {
    const rows = [
      { id: '1', key: 'X-Title', value: 'bad\n' },
      { id: '2', key: 'x-title', value: 'good' },
    ];
    expect(toHeaderRecord(rows)).toEqual({ 'x-title': 'good' });
  });

  it('caps forwarded headers at 20, keeping the first ones', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      key: `X-H${i}`,
      value: 'v',
    }));
    const record = toHeaderRecord(many);
    expect(Object.keys(record)).toHaveLength(20);
    expect(record['X-H0']).toBe('v');
    expect(record['X-H19']).toBe('v');
    expect(record['X-H20']).toBeUndefined();
    expect(activeHeaderCount(many)).toBe(20);
  });

  it('still sends a valid name too long to be saved', () => {
    const name = `X-${'a'.repeat(MAX_PERSISTED_NAME_LENGTH)}`;
    expect(toHeaderRecord([{ id: '1', key: name, value: 'v' }])).toEqual({ [name]: 'v' });
  });
});

describe('blankEntry', () => {
  it('returns a fresh entry with empty key/value and a unique id', () => {
    const a = blankEntry();
    const b = blankEntry();
    expect(a.key).toBe('');
    expect(a.value).toBe('');
    expect(a.id).not.toBe(b.id);
  });
});

describe('header storage (names only)', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists names only, never values', () => {
    persistHeaderNames([
      { id: '1', key: ' X-Title ', value: 'secret-ish' },
      { id: '2', key: 'HTTP-Referer', value: 'https://x' },
    ]);
    const raw = store[REQUEST_HEADER_NAMES_STORAGE_KEY]!;
    expect(JSON.parse(raw)).toEqual(['X-Title', 'HTTP-Referer']);
    expect(raw).not.toContain('secret-ish');
    expect(raw).not.toContain('https://x');
  });

  it('skips blocked, invalid, empty and duplicate names', () => {
    persistHeaderNames([
      { id: '1', key: 'Authorization', value: 'Bearer sk-live' },
      { id: '2', key: 'X Bad', value: 'v' },
      { id: '3', key: '', value: 'orphan' },
      { id: '4', key: 'X-Title', value: 'a' },
      { id: '5', key: 'x-title', value: 'b' },
    ]);
    expect(JSON.parse(store[REQUEST_HEADER_NAMES_STORAGE_KEY]!)).toEqual(['X-Title']);
  });

  // A long "name" is most likely a token pasted into the wrong field.
  it(`does not save names longer than ${MAX_PERSISTED_NAME_LENGTH} characters`, () => {
    const max = `X-${'a'.repeat(MAX_PERSISTED_NAME_LENGTH - 2)}`;
    const tooLong = `sk-proj-${'b'.repeat(MAX_PERSISTED_NAME_LENGTH)}`;
    persistHeaderNames([
      { id: '1', key: tooLong, value: 'v' },
      { id: '2', key: max, value: 'v' },
    ]);
    const raw = store[REQUEST_HEADER_NAMES_STORAGE_KEY]!;
    expect(JSON.parse(raw)).toEqual([max]);
    expect(raw).not.toContain('sk-proj-');
  });

  it('drops over-long names already saved when loading', () => {
    const tooLong = `X-${'c'.repeat(MAX_PERSISTED_NAME_LENGTH)}`;
    store[REQUEST_HEADER_NAMES_STORAGE_KEY] = JSON.stringify([tooLong, 'X-Title']);
    expect(loadStoredHeaderEntries().map((e) => e.key)).toEqual(['X-Title']);
    expect(store[REQUEST_HEADER_NAMES_STORAGE_KEY]).toBe('["X-Title"]');
  });

  it('removes the key when nothing is worth saving', () => {
    store[REQUEST_HEADER_NAMES_STORAGE_KEY] = '["X-Title"]';
    persistHeaderNames([{ id: '1', key: 'Authorization', value: 'Bearer x' }]);
    expect(store[REQUEST_HEADER_NAMES_STORAGE_KEY]).toBeUndefined();
  });

  it('caps the saved names at 20', () => {
    persistHeaderNames(
      Array.from({ length: 25 }, (_, i) => ({ id: String(i), key: `X-H${i}`, value: 'v' })),
    );
    expect(JSON.parse(store[REQUEST_HEADER_NAMES_STORAGE_KEY]!)).toHaveLength(20);
  });

  it('restores saved names as rows with empty values', () => {
    store[REQUEST_HEADER_NAMES_STORAGE_KEY] = '["X-Title","HTTP-Referer"]';
    const entries = loadStoredHeaderEntries();
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ['X-Title', ''],
      ['HTTP-Referer', ''],
    ]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
  });

  it('migrates legacy entries: keeps valid names, drops every value, removes the legacy key', () => {
    store[LEGACY_REQUEST_HEADERS_STORAGE_KEY] = JSON.stringify([
      { id: 'h1', key: 'X-Title', value: 'my-app' },
      { id: 'h2', key: 'authorization', value: 'Bearer sk-secret' },
      { id: 'h3', key: 'X-Custom-Token', value: 'tok-secret' },
      { id: 'h4', key: 'bad name', value: 'v' },
      'not-an-entry',
      null,
      { id: 'h5', value: 'no-key' },
    ]);
    const entries = loadStoredHeaderEntries();
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ['X-Title', ''],
      ['X-Custom-Token', ''],
    ]);
    expect(store[LEGACY_REQUEST_HEADERS_STORAGE_KEY]).toBeUndefined();
    const saved = store[REQUEST_HEADER_NAMES_STORAGE_KEY]!;
    expect(JSON.parse(saved)).toEqual(['X-Title', 'X-Custom-Token']);
    expect(JSON.stringify(store)).not.toMatch(/secret|my-app/);
  });

  it('prefers the current key and still removes a leftover legacy key', () => {
    store[REQUEST_HEADER_NAMES_STORAGE_KEY] = '["X-New"]';
    store[LEGACY_REQUEST_HEADERS_STORAGE_KEY] = JSON.stringify([
      { id: 'h1', key: 'X-Old', value: 'old-secret' },
    ]);
    expect(loadStoredHeaderEntries().map((e) => e.key)).toEqual(['X-New']);
    expect(store[LEGACY_REQUEST_HEADERS_STORAGE_KEY]).toBeUndefined();
  });

  it('rewrites a tampered current key, dropping non-strings, values and blocked names', () => {
    store[REQUEST_HEADER_NAMES_STORAGE_KEY] = JSON.stringify([
      'X-Title',
      { key: 'X-Obj', value: 'v' },
      'Cookie',
      42,
    ]);
    expect(loadStoredHeaderEntries().map((e) => e.key)).toEqual(['X-Title']);
    expect(JSON.parse(store[REQUEST_HEADER_NAMES_STORAGE_KEY]!)).toEqual(['X-Title']);
  });

  it('cleans up malformed or non-array legacy data', () => {
    store[LEGACY_REQUEST_HEADERS_STORAGE_KEY] = '{not json';
    expect(loadStoredHeaderEntries()).toEqual([]);
    expect(store[LEGACY_REQUEST_HEADERS_STORAGE_KEY]).toBeUndefined();

    store[LEGACY_REQUEST_HEADERS_STORAGE_KEY] = JSON.stringify({ not: 'array' });
    expect(loadStoredHeaderEntries()).toEqual([]);
    expect(store[LEGACY_REQUEST_HEADERS_STORAGE_KEY]).toBeUndefined();
    expect(store[REQUEST_HEADER_NAMES_STORAGE_KEY]).toBeUndefined();
  });

  it('cleanUpStoredHeaders (app startup) migrates and removes the legacy key', () => {
    store[LEGACY_REQUEST_HEADERS_STORAGE_KEY] = JSON.stringify([
      { id: 'h1', key: 'X-Title', value: 'my-app' },
      { id: 'h2', key: 'Authorization', value: 'Bearer sk-secret' },
    ]);
    cleanUpStoredHeaders();
    expect(store[LEGACY_REQUEST_HEADERS_STORAGE_KEY]).toBeUndefined();
    expect(store[REQUEST_HEADER_NAMES_STORAGE_KEY]).toBe('["X-Title"]');
    expect(JSON.stringify(store)).not.toMatch(/secret|my-app/);
    // Idempotent: a second run keeps the migrated names.
    cleanUpStoredHeaders();
    expect(store[REQUEST_HEADER_NAMES_STORAGE_KEY]).toBe('["X-Title"]');
  });

  it('cleanUpStoredHeaders leaves empty storage empty', () => {
    cleanUpStoredHeaders();
    expect(store).toEqual({});
  });

  it('returns no rows and does not throw when storage access throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(loadStoredHeaderEntries()).toEqual([]);
    expect(() => cleanUpStoredHeaders()).not.toThrow();
    expect(() => persistHeaderNames([{ id: '1', key: 'X-Title', value: 'v' }])).not.toThrow();
    expect(() => persistHeaderNames([])).not.toThrow();
  });

  it('does not throw when localStorage itself is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadStoredHeaderEntries()).toEqual([]);
    expect(() => cleanUpStoredHeaders()).not.toThrow();
    expect(() => persistHeaderNames([{ id: '1', key: 'X-Title', value: 'v' }])).not.toThrow();
  });
});
