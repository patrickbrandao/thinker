import type { AgentKeyView } from './api/agent-keys.js';

export const DAY_MS = 86_400_000;
export const MAX_EXPIRY_DAYS = 365;
export const EXPIRY_PRESETS = [7, 30, 90, 365] as const;
const STALE_DAYS = 90;

/**
 * A key unused for 90+ days: never used and created more than 90 days ago,
 * or last used more than 90 days ago. Revoked keys are not flagged.
 */
export function isStaleKey(key: AgentKeyView, now = Date.now()): boolean {
  if (key.status === 'revoked') return false;
  const ref = key.lastUsedAt ?? key.createdAt;
  const at = Date.parse(ref);
  return Number.isFinite(at) && now - at > STALE_DAYS * DAY_MS;
}

/** ISO expiry `days` from now. */
export function expiryInDays(days: number, now = Date.now()): string {
  return new Date(now + days * DAY_MS).toISOString();
}

/** `yyyy-mm-dd` of a timestamp in local time, for date inputs. */
export function dateInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * ISO expiry for a custom date (end of that local day), or null when the
 * date is not in the future or more than 365 days ahead.
 */
export function expiryFromDate(value: string, now = Date.now()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 0).getTime();
  if (!Number.isFinite(end) || end <= now || end > now + MAX_EXPIRY_DAYS * DAY_MS) return null;
  return new Date(end).toISOString();
}

/** Whole days until (positive) or since (negative) a timestamp. */
export function daysFromNow(ts: string, now = Date.now()): number {
  const diff = Date.parse(ts) - now;
  return diff >= 0 ? Math.ceil(diff / DAY_MS) : -Math.ceil(-diff / DAY_MS);
}
