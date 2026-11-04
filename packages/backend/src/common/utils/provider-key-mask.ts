import type { AuthType } from 'thinker-shared';
import { decryptWithAny, getDecryptionSecrets } from './crypto.util';

/** Most leading characters a masked key ever shows. */
export const MASK_PREFIX_MAX = 12;
/** Most trailing characters a masked key ever shows. */
export const MASK_SUFFIX_MAX = 4;
/** Longer hidden runs collapse to this many `*`. */
const MASK_HIDDEN_MAX = 8;
/** `tenant_providers.key_prefix` holds the first 8 characters of the key. */
const STORED_PREFIX_LENGTH = 8;

/**
 * How many leading and trailing characters of a key of `length` characters
 * may be shown: at most half of the key, at most 12 in front and 4 behind.
 */
export function maskBudget(length: number): { prefix: number; suffix: number } {
  const budget = Math.floor(Math.max(0, length) / 2);
  const prefix = Math.min(MASK_PREFIX_MAX, budget);
  const suffix = Math.min(MASK_SUFFIX_MAX, budget - prefix);
  return { prefix, suffix };
}

function hiddenRun(count: number): string {
  return '*'.repeat(Math.max(1, Math.min(count, MASK_HIDDEN_MAX)));
}

/**
 * Masks a secret so that at least half of it stays hidden: `public` becomes
 * `pub***`, a 40-character key shows its first 12 and last 4 characters.
 */
export function maskSecret(value: string): string {
  const chars = Array.from(value);
  if (chars.length === 0) return '';
  const { prefix, suffix } = maskBudget(chars.length);
  const hidden = chars.length - prefix - suffix;
  return (
    chars.slice(0, prefix).join('') +
    hiddenRun(hidden) +
    (suffix > 0 ? chars.slice(chars.length - suffix).join('') : '')
  );
}

/**
 * Masks a key from its stored prefix alone (the key could not be decrypted).
 * A prefix shorter than the stored length is the whole key; otherwise the key
 * is at least as long as the prefix, which bounds what may be shown.
 */
export function maskFromStoredPrefix(prefix: string | null | undefined): string | null {
  if (!prefix) return null;
  const chars = Array.from(prefix);
  if (chars.length < STORED_PREFIX_LENGTH) return maskSecret(prefix);
  const { prefix: shown } = maskBudget(chars.length);
  return chars.slice(0, shown).join('') + hiddenRun(MASK_HIDDEN_MAX);
}

/** Leading characters of a mask, before its first `*` (the visible prefix). */
function visiblePrefix(masked: string | null): string | null {
  if (!masked) return null;
  const idx = masked.indexOf('*');
  const head = idx === -1 ? masked : masked.slice(0, idx);
  return head.length > 0 ? head : null;
}

/**
 * Only plain API keys may be revealed or decrypted for display: connections
 * of type `api_key` (custom providers included) and `local` servers.
 * Subscription credentials (OAuth token blobs, pasted tokens) never are.
 */
export function isRevealableAuthType(authType: AuthType | string | null | undefined): boolean {
  return (authType ?? 'api_key') === 'api_key' || authType === 'local';
}

/** A JSON object in the credential slot is an OAuth token blob, never a plain key. */
export function looksLikeTokenBlob(plaintext: string): boolean {
  const trimmed = plaintext.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

export interface ProviderKeyDisplay {
  /** The visible leading characters of `key_masked` (never more than the mask shows). */
  key_prefix: string | null;
  /** The key with at least half of it replaced by `*`. */
  key_masked: string | null;
}

type KeyRow = {
  auth_type?: AuthType | string | null;
  api_key_encrypted?: string | null;
  key_prefix?: string | null;
};

/**
 * What any API response may say about a stored provider key. Plain API keys
 * are decrypted to mask their real length and tail; anything else, or a key
 * that fails to decrypt, falls back to the stored prefix under the same
 * budget. The plaintext never leaves this function.
 */
export function providerKeyDisplay(row: KeyRow): ProviderKeyDisplay {
  let masked: string | null = null;
  if (row.api_key_encrypted && isRevealableAuthType(row.auth_type)) {
    try {
      const plain = decryptWithAny(row.api_key_encrypted, getDecryptionSecrets()).plaintext;
      if (plain && !looksLikeTokenBlob(plain)) masked = maskSecret(plain);
    } catch {
      // Undecryptable (e.g. a different THINKER_ENCRYPTION_KEY): use the prefix.
    }
  }
  if (masked === null) masked = maskFromStoredPrefix(row.key_prefix);
  return { key_prefix: visiblePrefix(masked), key_masked: masked };
}
