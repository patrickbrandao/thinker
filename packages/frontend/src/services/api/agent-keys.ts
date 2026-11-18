import { fetchJson, fetchMutate } from './core.js';

/**
 * API keys of a harness. The primary key is the original one: it never
 * expires, can be revealed again (GET /agents/:name/key) and is rotated
 * instead of revoked. Extra keys carry an expiry and are shown once.
 */
export type AgentKeyStatus = 'active' | 'disabled' | 'expired' | 'revoked';

export interface AgentKeyView {
  id: string;
  name: string | null;
  keyPrefix: string;
  isPrimary: boolean;
  status: AgentKeyStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const base = (agentName: string) => `/agents/${encodeURIComponent(agentName)}/keys`;
const json = { 'Content-Type': 'application/json' };

export function listAgentKeys(agentName: string) {
  return fetchJson<{ keys: AgentKeyView[] }>(base(agentName));
}

export function createAgentKey(agentName: string, body: { name: string; expiresAt: string }) {
  return fetchMutate<{ key: AgentKeyView; apiKey: string }>(base(agentName), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(body),
  });
}

export function updateAgentKey(
  agentName: string,
  keyId: string,
  body: { name?: string; disabled?: boolean },
) {
  return fetchMutate<{ key: AgentKeyView }>(`${base(agentName)}/${encodeURIComponent(keyId)}`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify(body),
  });
}

export function revokeAgentKey(agentName: string, keyId: string) {
  return fetchMutate<{ key: AgentKeyView }>(`${base(agentName)}/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
  });
}
