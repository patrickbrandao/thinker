import type { IncomingHttpHeaders } from 'http';

const MAX_HEADERS = 200;
const MAX_VALUE_BYTES = 8192;
const MAX_TOTAL_BYTES = 65536;
const ELLIPSIS_BYTES = Buffer.byteLength('…', 'utf8');
const REDACTED = '[REDACTED]';

// Headers that can carry secrets. They are recorded (so the stored header set
// is complete) but their value is replaced, keeping only the auth scheme, so
// credentials never hit the DB. The Playground blocklist (thinker-shared) must
// cover every name here; a spec in playground/request-header-sanitizer.spec.ts
// guards that.
export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set<string>([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]);

/**
 * The headers exactly as received on the wire (direct or through a reverse
 * proxy), built from `rawHeaders` so values stamped later by middleware (e.g.
 * the `x-thinker-client-ip*` resolver headers) are not mistaken for client
 * headers. Repeated headers are kept as arrays. Falls back to `headers` when
 * the raw list is unavailable.
 */
export function receivedHeaders(req: {
  headers: IncomingHttpHeaders;
  rawHeaders?: string[];
}): IncomingHttpHeaders {
  const raw = req.rawHeaders;
  if (!Array.isArray(raw) || raw.length === 0) return req.headers;
  const out: Record<string, string | string[]> = {};
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const key = raw[i].toLowerCase();
    const value = raw[i + 1];
    const prev = out[key];
    if (prev === undefined) out[key] = value;
    else out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

function redact(key: string, value: string): string {
  if (key === 'authorization' || key === 'proxy-authorization') {
    const scheme = /^(\S+)\s+\S/.exec(value)?.[1];
    return scheme ? `${scheme} ${REDACTED}` : REDACTED;
  }
  return REDACTED;
}

export function sanitizeRequestHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  let totalBytes = 2; // account for `{}` of the eventual JSON
  let count = 0;

  for (const [rawKey, rawVal] of Object.entries(headers)) {
    if (count >= MAX_HEADERS) break;
    if (rawVal == null) continue;

    const key = rawKey.toLowerCase();
    const joined = Array.isArray(rawVal) ? rawVal.join(', ') : String(rawVal);
    const cleaned = joined.replace(/[\x00-\x1f\x7f]/g, '').trim();

    const value = SENSITIVE_HEADERS.has(key)
      ? redact(key, cleaned)
      : truncateUtf8(cleaned, MAX_VALUE_BYTES);

    // Measure the *actual* serialized cost (JSON.stringify handles escaping of
    // quotes, backslashes, control chars) so values full of `"` or `\` can't
    // silently blow past the total budget.
    const entryBytes =
      Buffer.byteLength(JSON.stringify(key), 'utf8') +
      Buffer.byteLength(JSON.stringify(value), 'utf8') +
      1 + // ":"
      (count === 0 ? 0 : 1); // leading "," for non-first entries
    if (totalBytes + entryBytes > MAX_TOTAL_BYTES) continue;

    out[key] = value;
    totalBytes += entryBytes;
    count++;
  }

  return count > 0 ? out : null;
}

// Truncate by UTF-8 byte length (not character count) so multi-byte values
// can't exceed the byte budget. When the cut lands mid-codepoint, Node's
// Buffer.toString replaces the partial sequence with U+FFFD — strip those so
// the stored value stays valid, then append a single ellipsis.
function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  const budget = Math.max(0, maxBytes - ELLIPSIS_BYTES);
  let sliced = buf.subarray(0, budget).toString('utf8');
  while (sliced.endsWith('\uFFFD')) sliced = sliced.slice(0, -1);
  return sliced + '…';
}
