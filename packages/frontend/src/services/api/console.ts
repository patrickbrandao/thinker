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

export type TopologyRange = '1h' | '24h' | '7d' | '30d';

interface Usage {
  requests: number;
  errors: number;
  costUsd: number;
  tokens: number;
}

export interface Topology {
  range: TopologyRange;
  harnesses: Array<
    Usage & { id: string; name: string; displayName: string | null; platform: string | null }
  >;
  hubs: Array<
    Usage & {
      id: string;
      kind: 'auto' | 'virtual' | 'header';
      agentId: string;
      agentName: string;
      name: string;
      enabled: boolean;
    }
  >;
  providers: Array<
    Usage & {
      id: string;
      provider: string;
      authType: string;
      name: string;
      connections: Array<{ id: string; label: string; active: boolean }>;
      models: string[];
    }
  >;
  links: TopologyLink[];
}

export interface TopologyLink {
  source: string;
  target: string;
  kind: 'entry' | 'primary' | 'fallback' | 'usage';
  requests: number;
  errors: number;
}

/** Harnesses, routing points, providers and the traffic of the window. */
export function getTopology(range: TopologyRange): Promise<Topology> {
  return fetchJson('/topology', { range }, { cache: false });
}
