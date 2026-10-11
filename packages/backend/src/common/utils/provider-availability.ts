import { normalizeProviderName, SHARED_PROVIDER_BY_ID_OR_ALIAS } from 'manifest-shared';

/**
 * True for built-in providers that run on the operator's own machine or LAN
 * (Ollama, LM Studio, llama.cpp). Thinker is always self-hosted, so these are
 * always available; the flag only drives display and accounting (no cost).
 */
export function isLocalOnlyProvider(provider: string): boolean {
  const lower = provider.trim().toLowerCase();
  const entry =
    SHARED_PROVIDER_BY_ID_OR_ALIAS.get(lower) ??
    SHARED_PROVIDER_BY_ID_OR_ALIAS.get(normalizeProviderName(lower));
  return entry?.localOnly === true;
}
