import { isPlaygroundHeaderBlocked } from 'manifest-shared';

/** One row of the Playground "Request headers" editor. */
export interface HeaderEntry {
  id: string;
  key: string;
  value: string;
}

/** Same cap the server applies (`MAX_HEADERS`). */
export const MAX_HEADER_ENTRIES = 20;

/**
 * Why the server will drop a header row, or `null` when it is sent.
 * - `blocked`: the name is on the shared blocklist (credentials, transport...).
 * - `invalid-name`: the name is not an RFC 9110 token.
 * - `control-chars`: the value has a control character (fetch rejects it).
 * - `unsupported-chars`: the value has a character above U+00FF, which an
 *   HTTP header can't carry.
 */
export type HeaderIssue = 'blocked' | 'invalid-name' | 'control-chars' | 'unsupported-chars';

/** RFC 9110 `token`, the same pattern the server sanitizer enforces. */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** C0 controls except horizontal tab, plus DEL. */
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000A-\u001F\u007F]/;
/** Any UTF-16 code unit above U+00FF (includes emoji surrogate halves). */
const UNSUPPORTED_CHARS_RE = /[\u0100-\uFFFF]/;

/**
 * Mirrors the server-side blocklist (shared list) so the user sees a warning
 * on exactly the headers the backend drops. The server still enforces it.
 */
export function isBlockedHeaderKey(key: string): boolean {
  return isPlaygroundHeaderBlocked(key);
}

/** True when the trimmed name is a valid HTTP token. Empty names are not valid. */
export function isValidHeaderName(key: string): boolean {
  return HEADER_NAME_RE.test(key.trim());
}

/** Problem with a header value that makes the server drop the header, if any. */
export function headerValueIssue(value: string): 'control-chars' | 'unsupported-chars' | null {
  if (CONTROL_CHARS_RE.test(value)) return 'control-chars';
  if (UNSUPPORTED_CHARS_RE.test(value)) return 'unsupported-chars';
  return null;
}

/**
 * Why this row will be dropped by the server. Rows with an empty name report
 * no issue, so a freshly added row doesn't flash a warning.
 */
export function headerEntryIssue(entry: Pick<HeaderEntry, 'key' | 'value'>): HeaderIssue | null {
  const key = entry.key.trim();
  if (!key) return null;
  if (!isValidHeaderName(key)) return 'invalid-name';
  if (isBlockedHeaderKey(key)) return 'blocked';
  return headerValueIssue(entry.value);
}

/** Headers that will actually be sent: named, valued and free of issues. */
export function toHeaderRecord(entries: HeaderEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) {
    const key = e.key.trim();
    if (!key || !e.value) continue;
    if (headerEntryIssue(e)) continue;
    out[key] = e.value;
  }
  return out;
}

export function activeHeaderCount(entries: HeaderEntry[]): number {
  return Object.keys(toHeaderRecord(entries)).length;
}

let nextId = 1;
export function blankEntry(): HeaderEntry {
  return { id: `h-${++nextId}-${Date.now().toString(36)}`, key: '', value: '' };
}

/*
 * Persistence. Only header NAMES are stored, never values: a value can be a
 * secret (a custom auth header the blocklist doesn't know about, or one typed
 * for a blocked name), and localStorage is plain text readable by any script
 * on the origin. Names alone keep the useful part (which headers you usually
 * send) while values live only for the current page visit.
 */

/** Current key: a JSON array of header names. */
export const REQUEST_HEADER_NAMES_STORAGE_KEY = 'thinker.playground.requestHeaderNames';
/**
 * Pre-#105 key that stored `{id, key, value}` entries with values in plain
 * text. Read once to keep the names, then removed.
 */
export const LEGACY_REQUEST_HEADERS_STORAGE_KEY = 'manifest.playground.requestHeaders';

/** Names worth keeping: trimmed, valid, not blocked, de-duplicated, capped. */
function persistableNames(names: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name || !isValidHeaderName(name) || isBlockedHeaderKey(name)) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(name);
    if (out.length >= MAX_HEADER_ENTRIES) break;
  }
  return out;
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeNames(names: string[]): void {
  try {
    if (names.length === 0) localStorage.removeItem(REQUEST_HEADER_NAMES_STORAGE_KEY);
    else localStorage.setItem(REQUEST_HEADER_NAMES_STORAGE_KEY, JSON.stringify(names));
  } catch {
    /* quota / private mode / storage disabled: nothing to persist */
  }
}

function removeLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_REQUEST_HEADERS_STORAGE_KEY);
  } catch {
    /* storage disabled */
  }
}

/**
 * Restores the saved header names as rows with empty values. Also migrates
 * and cleans storage: names are taken from the legacy entry list, its stored
 * values are discarded, the legacy key is removed, and the current key is
 * rewritten with only valid, non-blocked names.
 */
export function loadStoredHeaderEntries(): HeaderEntry[] {
  const current = readJson(REQUEST_HEADER_NAMES_STORAGE_KEY);
  let names: unknown[] = Array.isArray(current) ? current : [];

  const legacy = readJson(LEGACY_REQUEST_HEADERS_STORAGE_KEY);
  if (names.length === 0 && Array.isArray(legacy)) {
    names = legacy.map((e: unknown) =>
      typeof e === 'object' && e !== null ? (e as { key?: unknown }).key : undefined,
    );
  }
  removeLegacy();

  const clean = persistableNames(names);
  writeNames(clean);
  return clean.map((key) => ({ ...blankEntry(), key }));
}

/** Persists the names of the given rows (never their values). */
export function persistHeaderNames(entries: HeaderEntry[]): void {
  writeNames(persistableNames(entries.map((e) => e.key)));
}
