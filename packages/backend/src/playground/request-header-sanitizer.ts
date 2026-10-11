import { isPlaygroundHeaderBlocked } from 'manifest-shared';

const MAX_HEADERS = 20;
const MAX_VALUE_LENGTH = 2_000;

/** RFC 9110 `token`. Anything else is not a valid header name and makes fetch throw. */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** CR, LF and NUL are rejected by fetch and would allow header injection. */
const FORBIDDEN_VALUE_CHARS_RE = /[\r\n\0]/;

/**
 * Credential, tenant-identity, gateway-managed and transport headers a client
 * may not set. The list lives in `manifest-shared` so the dashboard warns on
 * exactly what the server drops. Compared case-insensitively after trimming.
 */
export function isBlockedHeaderName(name: string): boolean {
  return isPlaygroundHeaderBlocked(name);
}

/**
 * Sanitize user-supplied request headers before forwarding to a provider.
 * Drops blocklist entries silently (the client UI shows a warning; we don't
 * 400 the request). Returns `undefined` when nothing survives — callers can
 * skip the `extraHeaders` field entirely.
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
    if (!key || !HEADER_NAME_RE.test(key)) continue;
    if (isBlockedHeaderName(key)) continue;
    const value = rawValue.slice(0, MAX_VALUE_LENGTH);
    if (FORBIDDEN_VALUE_CHARS_RE.test(value)) continue;
    const lower = key.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
