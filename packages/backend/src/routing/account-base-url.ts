/**
 * Editable base URL of an API-key connection (`tenant_providers.base_url`).
 *
 * Since ADR 0012 it is the `inference` slot of the connection's editable
 * URLs (routing/provider-urls); this module keeps the legacy shortcut
 * (`PATCH .../base-url`, `accountBaseUrl` on connect, `base_url` fields).
 */
import { CustomProviderService } from './custom-provider/custom-provider.service';
import { resolveEndpointKey } from './proxy/provider-endpoints';
import { defaultProviderUrl, legacyBaseUrlFor } from './provider-urls/provider-urls';

const MAX_BASE_URL_LENGTH = 2048;

/** True when a connection of this provider and auth type may carry a base URL. */
export function supportsAccountBaseUrl(provider: string, authType: string | undefined): boolean {
  const lower = provider.toLowerCase();
  if ((authType ?? 'api_key') !== 'api_key') return false;
  if (CustomProviderService.isCustom(lower) || lower === 'ollama') return false;
  return resolveEndpointKey(lower) !== null;
}

/**
 * Trim and check the shape (http/https, no credentials, no query/fragment).
 * Returns null for an empty value (back to the official URL). SSRF checks are
 * the caller's (validatePublicUrl with the private-URL policy).
 */
export function normalizeAccountBaseUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.length > MAX_BASE_URL_LENGTH) throw new Error('Base URL is too long');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Base URL must be a valid http(s) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Base URL must use http or https');
  }
  if (url.username || url.password) throw new Error('Base URL must not contain credentials');
  if (url.search || url.hash) throw new Error('Base URL must not contain a query or fragment');
  return value.replace(/\/+$/, '');
}

/**
 * The URL a connection uses when it has no base URL of its own, in the
 * legacy `base_url` shape: the inference slot default (ADR 0012), region
 * included; OpenCode's OpenAI-protocol base, Bedrock's Mantle host.
 */
export function defaultAccountBaseUrl(
  provider: string,
  authType: string | undefined,
  region: string | null | undefined,
): string | null {
  const auth = authType ?? 'api_key';
  const defaults: Record<string, string> = {};
  for (const slot of ['inference', 'inference_mantle']) {
    const value = defaultProviderUrl(provider, auth, region, slot);
    if (value) defaults[slot] = value;
  }
  return legacyBaseUrlFor(provider, defaults);
}
