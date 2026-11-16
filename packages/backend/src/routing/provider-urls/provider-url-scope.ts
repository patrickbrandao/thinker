/**
 * The connection whose URLs an outbound call uses, and the fetch for a slot
 * URL (ADR 0012). Kept free of the defaults table so the OAuth services, the
 * Copilot token exchange and the model fetcher can import it without cycles.
 *
 * Deep call paths (an OAuth refresh inside the credential resolution, a token
 * exchange inside a login flow) read the connection from an AsyncLocalStorage
 * scope opened by whoever knows it (`runWithProviderUrls`): the credential
 * resolution, the Playground, the background monitors, and every login flow
 * with the overrides it was started with.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { PROVIDER_BY_ID_OR_ALIAS } from '../../common/constants/providers';
import { outboundFetch } from '../../common/outbound/outbound-proxy';
import { ssrfSafeFetch } from '../../common/utils/ssrf-safe-fetch';
import { validatePublicUrl } from '../../common/utils/url-validation';
import { allowsPrivateDestination } from '../../common/utils/private-url-policy';

/** What resolving a connection's URL needs (a `tenant_providers` row, or a pending flow). */
export interface ProviderUrlConnection {
  provider: string;
  /** `api_key` | `subscription` (anything else has no slots). */
  authType: string | null | undefined;
  region?: string | null;
  /** `tenant_providers.url_overrides`: slot id → URL. */
  urlOverrides?: Record<string, string> | null;
  /** Legacy `tenant_providers.base_url` (API-key connections): the inference slot. */
  baseUrl?: string | null;
  /** `tenant_providers.allow_private_destination` (absent = allowed). */
  allowPrivate?: boolean | null;
}

export interface ResolvedProviderUrl {
  url: string;
  /** True when the connection set this URL (or one it derives from). */
  overridden: boolean;
  /** Whether an overridden URL may reach private/LAN addresses at connect time. */
  allowPrivate: boolean;
}

/** Canonical provider id of the slot catalog (`google` → `gemini`, `alibaba` → `qwen`). */
export function canonicalUrlProvider(provider: string): string {
  const lower = provider.toLowerCase();
  return PROVIDER_BY_ID_OR_ALIAS.get(lower)?.id ?? lower;
}

/**
 * Overrides implied by the legacy `base_url` column, which held the inference
 * base of an API-key connection. OpenCode's held the OpenAI-protocol base
 * (`…/inference[/go]/openai`), so its common base is what is left; Bedrock's
 * replaced both hosts, Mantle and Runtime.
 */
export function legacyBaseUrlOverrides(
  provider: string,
  authType: string | null | undefined,
  baseUrl: string | null | undefined,
): Record<string, string> {
  if (!baseUrl || (authType ?? 'api_key') !== 'api_key') return {};
  const id = canonicalUrlProvider(provider);
  if (id === 'bedrock') return { inference_mantle: baseUrl, inference_runtime: baseUrl };
  if (id === 'opencode' || id === 'opencode-go') {
    return { inference: baseUrl.replace(/\/openai$/, '') };
  }
  return { inference: baseUrl };
}

/** The value the legacy `base_url` column mirrors for these overrides (rollback). */
export function legacyBaseUrlFor(
  provider: string,
  overrides: Record<string, string>,
): string | null {
  const id = canonicalUrlProvider(provider);
  if (id === 'bedrock') return overrides.inference_mantle ?? null;
  if (!overrides.inference) return null;
  if (id === 'opencode' || id === 'opencode-go') return `${overrides.inference}/openai`;
  return overrides.inference;
}

/**
 * The connection's overrides. Once written through the URL API the column is
 * authoritative (`{}` included); before that, the legacy base URL stands for
 * the inference slot.
 */
export function effectiveUrlOverrides(conn: ProviderUrlConnection): Record<string, string> {
  if (conn.urlOverrides) return conn.urlOverrides;
  return legacyBaseUrlOverrides(conn.provider, conn.authType, conn.baseUrl);
}

const scope = new AsyncLocalStorage<ProviderUrlConnection>();

/** Run `fn` with `conn` as the connection whose URLs nested calls use. */
export function runWithProviderUrls<T>(
  conn: ProviderUrlConnection | undefined | null,
  fn: () => T,
): T {
  return conn ? scope.run(conn, fn) : fn();
}

export function currentProviderUrls(): ProviderUrlConnection | undefined {
  return scope.getStore();
}

/** A built-in URL, not overridden. */
export function builtInProviderUrl(url: string): ResolvedProviderUrl {
  return { url, overridden: false, allowPrivate: true };
}

/**
 * The URL for a slot of the connection in scope, or `builtIn` when the scope
 * holds another connection, none, or no override for the slot. For slots that
 * never derive from another one (OAuth, device code, token exchange, usage).
 */
export function scopedProviderUrl(
  provider: string,
  authType: string,
  slotId: string,
  builtIn: string,
): ResolvedProviderUrl {
  const conn = scope.getStore();
  if (
    !conn ||
    (conn.authType ?? 'api_key') !== authType ||
    canonicalUrlProvider(conn.provider) !== canonicalUrlProvider(provider)
  ) {
    return builtInProviderUrl(builtIn);
  }
  const value = effectiveUrlOverrides(conn)[slotId];
  if (!value) return builtInProviderUrl(builtIn);
  return {
    url: value,
    overridden: true,
    allowPrivate: allowsPrivateDestination(conn.allowPrivate),
  };
}

/**
 * Rewrite `url` from `fromBase` onto `toBase` when it lives under it (the
 * prefix ends at a path, query or end boundary). Trailing slashes are
 * dropped, nothing else: a `/v1` in either base stays.
 */
export function rebaseOnto(url: string, fromBase: string, toBase: string): string | null {
  const from = fromBase.replace(/\/+$/, '');
  if (!url.startsWith(from)) return null;
  const rest = url.slice(from.length);
  if (rest && !rest.startsWith('/') && !rest.startsWith('?')) return null;
  return `${toBase.replace(/\/+$/, '')}${rest}`;
}

/** Thrown before sending when an overridden URL fails the SSRF check. */
export class ProviderUrlRefusedError extends Error {
  readonly code = 'ESSRFBLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUrlRefusedError';
  }
}

/**
 * `fetch` for a slot URL. A built-in one goes out as before (outbound proxy
 * chain); an overridden one is SSRF-revalidated, pinned to the validated
 * address and refuses redirects, so a 307/308 can never resend a token or a
 * refresh token somewhere else.
 */
export async function fetchProviderUrl(
  resolved: ResolvedProviderUrl,
  init: RequestInit = {},
  url: string = resolved.url,
): Promise<Response> {
  if (!resolved.overridden) return outboundFetch(url, init);
  try {
    await validatePublicUrl(url, { allowPrivate: resolved.allowPrivate });
  } catch (err) {
    throw new ProviderUrlRefusedError(`Refusing provider URL: ${(err as Error).message}`);
  }
  return ssrfSafeFetch(
    url,
    { ...init, redirect: 'error' },
    { allowPrivate: resolved.allowPrivate },
  );
}

/** A cached provider key (`CachedProviderKey`) of a connection, as its URLs. */
export function keyUrlConnection(
  provider: string,
  authType: string,
  key: {
    region?: string | null;
    urlOverrides?: Record<string, string> | null;
    baseUrl?: string | null;
    baseUrlAllowsPrivate?: boolean;
  },
): ProviderUrlConnection {
  return {
    provider,
    authType,
    region: key.region ?? null,
    urlOverrides: key.urlOverrides ?? null,
    baseUrl: key.baseUrl ?? null,
    allowPrivate: key.baseUrlAllowsPrivate !== false,
  };
}

/** A slot URL with a path appended (base slots: console, OIDC, OAuth, Code Assist). */
export function withPath(resolved: ResolvedProviderUrl, path: string): ResolvedProviderUrl {
  return { ...resolved, url: `${resolved.url.replace(/\/+$/, '')}${path}` };
}
