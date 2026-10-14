import {
  isPlaygroundHeaderBlocked,
  isPlaygroundHeaderNameValid,
  isPlaygroundHeaderValueValid,
} from 'thinker-shared';

/** One row of the Playground "Request headers" editor. */
export interface HeaderEntry {
  id: string;
  key: string;
  value: string;
}

/** Same cap the server applies (`MAX_HEADERS`). */
export const MAX_HEADER_ENTRIES = 20;

/**
 * Longest name that is saved to localStorage. Real header names are short; a
 * longer "name" is most likely a token pasted into the wrong field, so it is
 * kept in memory (and sent, if valid) but never written to disk.
 */
export const MAX_PERSISTED_NAME_LENGTH = 64;

/**
 * Why the server will drop a header row, or `null` when it is sent.
 * - `blocked`: the name is on the shared blocklist (credentials, transport...).
 * - `invalid-name`: the name is not an RFC 9110 token.
 * - `control-chars`: the value has a control character (fetch rejects it).
 * - `unsupported-chars`: the value has a character above U+00FF, which an
 *   HTTP header can't carry.
 * - `duplicate`: an earlier row already sends the same name (names are
 *   case-insensitive and the first one wins).
 * - `over-limit`: MAX_HEADER_ENTRIES headers are already being sent.
 */
export type HeaderIssue =
  'blocked' | 'invalid-name' | 'control-chars' | 'unsupported-chars' | 'duplicate' | 'over-limit';

/** Any UTF-16 code unit above U+00FF (includes emoji surrogate halves). */
const UNSUPPORTED_CHARS_RE = /[\u0100-\uFFFF]/;

/**
 * Mirrors the server-side blocklist (shared list) so the user sees a warning
 * on exactly the headers the backend drops. The server still enforces it.
 */
export function isBlockedHeaderKey(key: string): boolean {
  return isPlaygroundHeaderBlocked(key);
}

/** True when the trimmed name is a valid HTTP token (shared rule). Empty names are not valid. */
export function isValidHeaderName(key: string): boolean {
  return isPlaygroundHeaderNameValid(key);
}

/** Problem with a header value that makes the server drop the header, if any. */
export function headerValueIssue(value: string): 'control-chars' | 'unsupported-chars' | null {
  if (isPlaygroundHeaderValueValid(value)) return null;
  return UNSUPPORTED_CHARS_RE.test(value) ? 'unsupported-chars' : 'control-chars';
}

/**
 * Why this row, on its own, will be dropped by the server. Rows with an empty
 * name report no issue, so a freshly added row doesn't flash a warning.
 * Problems that depend on the other rows (`duplicate`, `over-limit`) come from
 * `headerEntryIssues`.
 */
export function headerEntryIssue(entry: Pick<HeaderEntry, 'key' | 'value'>): HeaderIssue | null {
  const key = entry.key.trim();
  if (!key) return null;
  if (!isValidHeaderName(key)) return 'invalid-name';
  if (isBlockedHeaderKey(key)) return 'blocked';
  return headerValueIssue(entry.value);
}

/**
 * Walks the rows the way the server sanitizer does and returns what is sent
 * plus, per row id, why a row is dropped. Rows with an empty name or value are
 * neither sent nor flagged.
 */
function evaluateEntries(entries: HeaderEntry[]): {
  record: Record<string, string>;
  issues: Map<string, HeaderIssue>;
} {
  const record: Record<string, string> = {};
  const issues = new Map<string, HeaderIssue>();
  const seenLower = new Set<string>();
  for (const e of entries) {
    const key = e.key.trim();
    const own = headerEntryIssue(e);
    if (own) {
      issues.set(e.id, own);
      continue;
    }
    if (!key || !e.value) continue;
    const lower = key.toLowerCase();
    if (seenLower.has(lower)) {
      issues.set(e.id, 'duplicate');
      continue;
    }
    if (seenLower.size >= MAX_HEADER_ENTRIES) {
      issues.set(e.id, 'over-limit');
      continue;
    }
    seenLower.add(lower);
    record[key] = e.value;
  }
  return { record, issues };
}

/** Per-row reasons the server will drop a row, including duplicates and rows past the cap. */
export function headerEntryIssues(entries: HeaderEntry[]): Map<string, HeaderIssue> {
  return evaluateEntries(entries).issues;
}

/**
 * Headers that will actually be forwarded: named, valued and free of issues.
 * Mirrors the server sanitizer: names are case-insensitive and the FIRST
 * occurrence wins, and at most MAX_HEADER_ENTRIES are kept. So the badge
 * count equals what reaches the provider.
 */
export function toHeaderRecord(entries: HeaderEntry[]): Record<string, string> {
  return evaluateEntries(entries).record;
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

/**
 * Names worth keeping: trimmed, valid, not blocked, at most
 * MAX_PERSISTED_NAME_LENGTH characters, de-duplicated, capped.
 */
function persistableNames(names: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name || name.length > MAX_PERSISTED_NAME_LENGTH) continue;
    if (!isValidHeaderName(name) || isBlockedHeaderKey(name)) continue;
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
 * Reads the saved header names and cleans storage in the same pass: names
 * are taken from the legacy entry list when the current key is empty, every
 * legacy value is discarded, the legacy key is removed, and the current key
 * is rewritten with only persistable names. Never throws.
 */
function readAndCleanStoredNames(): string[] {
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
  return clean;
}

/**
 * Run once at app startup so header values saved by older builds are wiped
 * even if the user never opens the Playground again. Never throws.
 */
export function cleanUpStoredHeaders(): void {
  readAndCleanStoredNames();
}

/** Restores the saved header names as rows with empty values (and cleans storage). */
export function loadStoredHeaderEntries(): HeaderEntry[] {
  return readAndCleanStoredNames().map((key) => ({ ...blankEntry(), key }));
}

/** Persists the names of the given rows (never their values). */
export function persistHeaderNames(entries: HeaderEntry[]): void {
  writeNames(persistableNames(entries.map((e) => e.key)));
}
