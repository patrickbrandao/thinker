import type { SystemEventView } from 'thinker-shared';
import { fetchJson, fetchMutate } from './core.js';

export interface AlertFilters {
  level?: string;
  category?: string;
  unread?: boolean;
  page?: number;
  limit?: number;
}

export interface AlertEventsPage {
  events: SystemEventView[];
  total: number;
  unread: number;
  page: number;
  limit: number;
}

function query(filters: AlertFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (filters.level) q.level = filters.level;
  if (filters.category) q.category = filters.category;
  if (filters.unread) q.unread = '1';
  if (filters.page) q.page = String(filters.page);
  if (filters.limit) q.limit = String(filters.limit);
  return q;
}

/** Alerts the user can see, newest first. */
export function listAlertEvents(filters: AlertFilters = {}): Promise<AlertEventsPage> {
  return fetchJson('/alerts/events', query(filters), { cache: false });
}

/** Marks one alert as read, for everyone. */
export function markAlertRead(id: string): Promise<void> {
  return fetchMutate(`/alerts/events/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

/** Marks every unread alert the user can see (matching the filters) as read. */
export function markAllAlertsRead(filters: AlertFilters = {}): Promise<{ updated: number }> {
  const q = new URLSearchParams(query({ ...filters, page: undefined, limit: undefined }));
  const suffix = q.toString() ? `?${q}` : '';
  return fetchMutate(`/alerts/events/read-all${suffix}`, { method: 'POST' });
}
