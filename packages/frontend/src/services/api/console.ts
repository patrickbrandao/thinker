import { fetchJson } from './core.js';

export type SearchResultType =
  | 'harness'
  | 'connection'
  | 'custom_provider'
  | 'virtual_model'
  | 'header_tier'
  | 'model'
  | 'member';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface AlertItem {
  id: string;
  timestamp: string;
  agentName: string | null;
  model: string | null;
  status: string;
  errorMessage: string | null;
  errorHttpStatus: number | null;
  errorClass: string | null;
}

/** Configuration objects of the active organization matching `q` (⌘K). */
export function searchConsole(q: string): Promise<{ results: SearchResult[] }> {
  return fetchJson('/search', { q }, { cache: false });
}

/** Failed requests of the last 24 hours (alerts bell). */
export function getAlerts(): Promise<{ items: AlertItem[]; total: number }> {
  return fetchJson('/alerts', undefined, { cache: false });
}
