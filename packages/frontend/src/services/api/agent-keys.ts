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
  /** The full key can be shown again (stored encrypted). */
  recoverable: boolean;
  /** Source IP restriction: when enabled, accepted only from the linked IP prefix lists. */
  ipRestriction: { enabled: boolean; listIds: string[] };
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
  body: { name?: string; disabled?: boolean; expiresAt?: string | null },
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

/** New secret for one key (primary or extra), shown once; id, name, expiry and IP restriction stay. */
export function rotateOneAgentKey(agentName: string, keyId: string) {
  return fetchMutate<{ key: AgentKeyView; apiKey: string }>(
    `${base(agentName)}/${encodeURIComponent(keyId)}/rotate`,
    { method: 'POST' },
  );
}

/** Full secret of a key; `apiKey` is absent when the key cannot be shown again. */
export function getAgentKeySecret(agentName: string, keyId: string) {
  return fetchJson<{ keyPrefix: string; apiKey?: string }>(
    `${base(agentName)}/${encodeURIComponent(keyId)}/secret`,
  );
}
