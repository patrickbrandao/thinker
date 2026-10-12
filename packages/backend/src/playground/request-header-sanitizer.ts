import {
  isPlaygroundHeaderBlocked,
  isPlaygroundHeaderNameValid,
  isPlaygroundHeaderValueValid,
} from 'thinker-shared';

const MAX_HEADERS = 20;
const MAX_VALUE_LENGTH = 2_000;

/**
 * Credential, tenant-identity, gateway-managed and transport headers a client
 * may not set. The list lives in `thinker-shared` so the dashboard warns on
 * exactly what the server drops. Compared case-insensitively after trimming.
 */
export function isBlockedHeaderName(name: string): boolean {
  return isPlaygroundHeaderBlocked(name);
}

/**
 * Sanitize user-supplied request headers before forwarding to a provider.
 * Silently drops blocklist entries, invalid names, and values fetch would
 * refuse (the client UI shows a warning; we don't 400 the request, and the run
 * goes ahead without the dropped header). Returns `undefined` when nothing
 * survives — callers can skip the `extraHeaders` field entirely.
 */
export function sanitizeRequestHeaders(
  raw: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined;
  // HTTP header names are case-insensitive. Without this, `{'X-Title':'a','x-title':'b'}`
  // forwards two distinct headers, lets a client fingerprint upstream caches,
  // and burns two of MAX_HEADERS slots for one logical header.
  const out: Record<string, string> = {};
  const seenLower = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_HEADERS) break;
    if (typeof rawKey !== 'string' || typeof rawValue !== 'string') continue;
    const key = rawKey.trim();
    // Name check before the blocklist: see isPlaygroundHeaderNameValid.
    if (!key || !isPlaygroundHeaderNameValid(key)) continue;
    if (isBlockedHeaderName(key)) continue;
    const value = rawValue.slice(0, MAX_VALUE_LENGTH);
    if (!isPlaygroundHeaderValueValid(value)) continue;
    const lower = key.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
