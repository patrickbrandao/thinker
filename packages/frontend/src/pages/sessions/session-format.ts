import { formatCost } from '../../services/formatters.js';

const MINUTE = 60_000;

/** "45s", "12m", "2h 14m", "3d 5h". */
export function spanLabel(fromIso: string, toIso: string): string {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  if (ms < MINUTE) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Live: activity in the last five minutes. A `pending` request alone does
 * not count, since one the gateway never closed would keep it live forever.
 */
export function isActive(lastIso: string): boolean {
  return Date.now() - Date.parse(lastIso) < 5 * MINUTE;
}

export function costLabel(cost: number): string {
  return formatCost(cost) ?? '—';
}

/** `ses_e7fb03c66ffdoZ2E7CHux6fAfO` → `ses_e7fb03c6…6fAfO`. */
export function shortId(id: string): string {
  return id.length > 22 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id;
}
