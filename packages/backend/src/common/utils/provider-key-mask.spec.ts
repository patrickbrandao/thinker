import { encrypt } from './crypto.util';
import {
  maskBudget,
  maskFromStoredPrefix,
  maskSecret,
  providerKeyDisplay,
} from './provider-key-mask';

const visibleChars = (masked: string) => masked.replace(/\*/g, '').length;

describe('maskBudget', () => {
  it.each([
    [0, 0, 0],
    [1, 0, 0],
    [2, 1, 0],
    [6, 3, 0],
    [20, 10, 0],
    [24, 12, 0],
    [26, 12, 1],
    [32, 12, 4],
    [40, 12, 4],
    [200, 12, 4],
  ])('length %i shows %i leading and %i trailing characters', (len, prefix, suffix) => {
    expect(maskBudget(len)).toEqual({ prefix, suffix });
  });
});

describe('maskSecret', () => {
  it('hides a 1-character key completely', () => {
    expect(maskSecret('x')).toBe('*');
  });

  it('shows half of a short shared key', () => {
    expect(maskSecret('public')).toBe('pub***');
  });

  it('shows no tail while the prefix uses the whole budget (20 chars)', () => {
    const key = 'abcdefghij0123456789';
    expect(maskSecret(key)).toBe('abcdefghij********');
  });

  it('shows 12 leading and 4 trailing characters of a 32-char key', () => {
    const key = 'sk-proj-ABCDEFGHIJKLMNOPQRS-WXYZ';
    expect(key).toHaveLength(32);
    expect(maskSecret(key)).toBe('sk-proj-ABCD********WXYZ');
  });

  it('collapses the hidden middle of a long key', () => {
    const key = `sk-or-v1-${'a'.repeat(60)}9876`;
    expect(maskSecret(key)).toBe('sk-or-v1-aaa********9876');
  });

  it('never shows more than half of any key', () => {
    for (let len = 1; len <= 80; len++) {
      const masked = maskSecret('k'.repeat(len));
      expect(visibleChars(masked)).toBeLessThanOrEqual(Math.floor(len / 2));
      expect(masked).toContain('*');
    }
  });

  it('returns an empty string for an empty key', () => {
    expect(maskSecret('')).toBe('');
  });
});

describe('maskFromStoredPrefix', () => {
  it('treats a prefix shorter than 8 characters as the whole key', () => {
    expect(maskFromStoredPrefix('public')).toBe('pub***');
  });

  it('cuts a full 8-character prefix to the budget of an 8-character key', () => {
    expect(maskFromStoredPrefix('sk-proj-')).toBe('sk-p********');
  });

  it('returns null without a prefix', () => {
    expect(maskFromStoredPrefix(null)).toBeNull();
    expect(maskFromStoredPrefix('')).toBeNull();
  });
});

describe('providerKeyDisplay', () => {
  const original = process.env.THINKER_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.THINKER_ENCRYPTION_KEY = 'm'.repeat(48);
  });
  afterAll(() => {
    if (original === undefined) delete process.env.THINKER_ENCRYPTION_KEY;
    else process.env.THINKER_ENCRYPTION_KEY = original;
  });

  it('masks a decrypted API key with its real tail', () => {
    const key = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234';
    const out = providerKeyDisplay({
      auth_type: 'api_key',
      api_key_encrypted: encrypt(key, 'm'.repeat(48)),
      key_prefix: key.slice(0, 8),
    });
    expect(out).toEqual({ key_prefix: 'sk-ant-api03', key_masked: 'sk-ant-api03********1234' });
  });

  it('masks a local server key the same way', () => {
    const out = providerKeyDisplay({
      auth_type: 'local',
      api_key_encrypted: encrypt('public', 'm'.repeat(48)),
      key_prefix: 'public',
    });
    expect(out.key_masked).toBe('pub***');
  });

  it('falls back to the stored prefix when the key does not decrypt', () => {
    const out = providerKeyDisplay({
      auth_type: 'api_key',
      api_key_encrypted: encrypt('sk-proj-0123456789abcdef', 'x'.repeat(48)),
      key_prefix: 'sk-proj-',
    });
    expect(out).toEqual({ key_prefix: 'sk-p', key_masked: 'sk-p********' });
  });

  it('never decrypts subscription credentials', () => {
    const blob = JSON.stringify({ access_token: 'secret-access', refresh_token: 'secret-ref' });
    const out = providerKeyDisplay({
      auth_type: 'subscription',
      api_key_encrypted: encrypt(blob, 'm'.repeat(48)),
      key_prefix: blob.slice(0, 8),
    });
    expect(out.key_masked).toBe('{"ac********');
  });

  it('reports nothing when no key is stored', () => {
    expect(
      providerKeyDisplay({ auth_type: 'api_key', api_key_encrypted: null, key_prefix: null }),
    ).toEqual({ key_prefix: null, key_masked: null });
  });
});
