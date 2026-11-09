import { fetchJson, fetchMutate } from './core.js';

/** A management API key of the active organization (API, CLI and MCP). */
export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  kind: 'admin' | 'cli';
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_by_email: string | null;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  key: string;
  key_prefix: string;
  expires_at: string | null;
}

export function listApiKeys(): Promise<{ keys: ApiKeyRow[] }> {
  return fetchJson('/api-keys', undefined, { cache: false });
}

export function createApiKey(name: string, expiresInDays: number | null): Promise<CreatedApiKey> {
  return fetchMutate('/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...(expiresInDays ? { expires_in_days: expiresInDays } : {}) }),
  });
}

export function revokeApiKey(id: string): Promise<{ revoked: true }> {
  return fetchMutate(`/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
