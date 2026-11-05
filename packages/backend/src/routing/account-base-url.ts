/**
 * Editable base URL of an API-key connection (`tenant_providers.base_url`).
 *
 * Precedence when forwarding and discovering models: the connection's own
 * base URL, then its region, then the provider's built-in endpoint. The URL
 * replaces only the base; every API path stays the same. Subscriptions
 * (OAuth/token) keep their fixed hosts, so a token is never sent elsewhere.
 */
import { CustomProviderService } from './custom-provider/custom-provider.service';
import { PROVIDER_ENDPOINTS, resolveEndpointKey } from './proxy/provider-endpoints';
import { resolveForwardEndpoint } from './proxy/forward-endpoint-resolver';
import { normalizeProviderBaseUrl } from './provider-base-url';

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
 * The URL a connection uses when it has no base URL of its own: the region's
 * endpoint when the region changes it, else the provider's built-in one.
 */
export function defaultAccountBaseUrl(
  provider: string,
  authType: string | undefined,
  region: string | null | undefined,
): string | null {
  const { customEndpoint } = resolveForwardEndpoint({
    provider,
    authType: authType ?? 'api_key',
    model: '',
    providerRegion: region ?? null,
  });
  if (customEndpoint) return customEndpoint.baseUrl;
  const key = resolveEndpointKey(provider);
  return key ? (PROVIDER_ENDPOINTS[key]?.baseUrl ?? null) : null;
}

/** Rewrites a built-in URL (e.g. a models endpoint) onto the connection's base. */
export function rebaseUrl(url: string, officialBase: string | null, accountBase: string): string {
  if (!officialBase) return url;
  const from = normalizeProviderBaseUrl(officialBase);
  if (!url.startsWith(from)) return url;
  return `${normalizeProviderBaseUrl(accountBase)}${url.slice(from.length)}`;
}
