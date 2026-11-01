import { fetchJson, fetchMutate } from './core.js';

export type SearchResultType =
  'harness' | 'connection' | 'custom_provider' | 'virtual_model' | 'model' | 'member';

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
  /** Requests of the last minute, whatever the window. */
  recent: number;
}

export interface Topology {
  range: TopologyRange;
  /** Client addresses that called a harness in the window. */
  clients: Array<{ id: string; ip: string; requests: number; errors: number; recent: number }>;
  harnesses: Array<
    Usage & { id: string; name: string; displayName: string | null; platform: string | null }
  >;
  /** Provider connections a harness reaches. */
  providers: Array<
    Usage & {
      id: string;
      connectionId: string;
      provider: string;
      authType: string;
      name: string;
      label: string;
      active: boolean;
    }
  >;
  /** Outbound proxy profiles in use (`profileId` null: the global proxy). */
  proxies: Array<Usage & { id: string; profileId: string | null; name: string }>;
  /** `internet` behind a proxy, `gateway` (direct from the instance) or `local` (local servers). */
  egress: Array<Usage & { id: 'internet' | 'gateway' | 'local' }>;
  links: TopologyLink[];
  /** Saved canvas positions, by node id. */
  positions: Record<string, { x: number; y: number }>;
}

export interface TopologyLinkModel {
  /** Virtual model name, or "auto". */
  via: string;
  model: string;
  kind: 'primary' | 'fallback' | 'usage';
  requests: number;
}

export interface TopologyLink {
  source: string;
  target: string;
  kind: 'client' | 'primary' | 'fallback' | 'usage' | 'egress';
  requests: number;
  errors: number;
  costUsd: number;
  /** Requests of the last minute (sizes the line). */
  recent: number;
  models?: TopologyLinkModel[];
}

/** Clients, harnesses, connections, proxies and the traffic of the window. */
export function getTopology(range: TopologyRange): Promise<Topology> {
  return fetchJson('/topology', { range }, { cache: false });
}

/** Saves where the user dropped canvas nodes (per workspace). */
export function saveTopologyPositions(
  positions: Array<{ id: string; x: number; y: number }>,
): Promise<void> {
  return fetchMutate('/topology/positions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  });
}

/** Drops the saved positions, back to the column layout. */
export function resetTopologyPositions(): Promise<void> {
  return fetchMutate('/topology/positions', { method: 'DELETE' });
}
