import { toast } from '../toast-store.js';
import { cachedFetch, isCacheable, invalidateAll } from './cache.js';
import {
  isPasswordChangeRequiredBody,
  markPasswordChangeRequired,
  withOrganizationHeader,
} from '../org-context.js';
import { t } from '../../i18n/index.js';

export const BASE_URL = '/api/v1';

/** Options for {@link fetchJson}. */
export interface FetchJsonOptions {
  /**
   * Per-call opt-out of the SWR cache. Defaults to `true` (cache on) for any
   * cacheable GET. Pass `false` to force a live network read — e.g. for a
   * surface that must never serve a stale payload but isn't on the global
   * deny-list. Deny-listed URLs are never cached regardless of this flag.
   */
  cache?: boolean;
  /**
   * Whether a 401 that looks like a session expiry hard-navigates the browser
   * to `/login`. Defaults to `true`. Pass `false` for a probe that may run
   * before the session is known: it then rejects with the same error and
   * leaves the redirect, and the preserved requested path, to the auth guard.
   */
  loginRedirect?: boolean;
}

export async function fetchJson<T>(
  path: string,
  params?: Record<string, string | undefined>,
  options?: FetchJsonOptions,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  const key = url.toString();

  // Default-on SWR caching for GETs, unless the caller opted out or the URL is on
  // the always-fresh deny-list (sessions, key reveal/rotate, SSE, health).
  const useCache = options?.cache !== false && isCacheable(key);
  const loginRedirect = options?.loginRedirect !== false;
  if (useCache) {
    return cachedFetch<T>(key, () => doFetchJson<T>(key, loginRedirect));
  }
  return doFetchJson<T>(key, loginRedirect);
}

/** Performs the raw GET + error handling. Kept separate so the cache wraps only the network. */
async function doFetchJson<T>(url: string, loginRedirect = true): Promise<T> {
  // 'default' lets the browser revalidate via ETag / Cache-Control. Backend
  // analytics endpoints set short max-age=10 which keeps stale UI bounded;
  // SSE-driven refetches still bypass cache because they pass a unique signal.
  const headers = withOrganizationHeader();
  const res = await fetch(url, {
    credentials: 'include',
    cache: 'default',
    ...(headers ? { headers } : {}),
  });
  if (res.status === 401) {
    // Only redirect to /login when the 401 looks like a real session
    // expiry. Per-endpoint 401s (e.g. an endpoint that requires a
    // user-scoped credential when called with a shared API key) shouldn't
    // log the user out.
    const body = await res.text().catch(() => '');
    const looksLikeSessionExpiry =
      !body || /session|cookie|unauthenticated|not authenticated/i.test(body);
    if (looksLikeSessionExpiry) {
      if (loginRedirect && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      throw new Error(t('ui.errors.sessionExpired'));
    }
    throw new Error(body || t('ui.errors.unauthorized'));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && isPasswordChangeRequiredBody(safeParse(body))) {
      markPasswordChangeRequired();
    }
    throw new Error(
      body || t('ui.errors.apiError', { status: res.status, statusText: res.statusText }),
    );
  }
  return res.json() as Promise<T>;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) return body.message.join(', ');
  } catch {
    // not JSON — fall through
  }
  return t('ui.errors.requestFailed', { status: res.status });
}

/**
 * Error thrown by {@link fetchMutate}. Carries the HTTP status so a caller can
 * tell a validation error (400) from a conflict (409) and place the message
 * next to the field it concerns.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Options for {@link fetchMutate}. */
export interface FetchMutateOptions {
  /**
   * Skip the global error toast. For a caller that shows the backend message
   * inline (for example next to a form field), so it is not shown twice.
   */
  silent?: boolean;
}

export async function fetchMutate<T = void>(
  path: string,
  options: RequestInit,
  mutateOptions?: FetchMutateOptions,
): Promise<T> {
  const headers = withOrganizationHeader(options.headers);
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    ...(headers ? { headers } : {}),
  });
  if (!res.ok) {
    if (res.status === 403 && typeof res.clone === 'function') {
      const body = await res
        .clone()
        .json()
        .catch(() => null);
      if (isPasswordChangeRequiredBody(body)) {
        markPasswordChangeRequired();
        throw new ApiError('Password change required', 403, 'password_change_required');
      }
    }
    const message = await parseErrorMessage(res);
    if (!mutateOptions?.silent) toast.error(message);
    throw new ApiError(message, res.status);
  }
  // A mutation (POST/PUT/PATCH/DELETE) can change data behind any number of GET
  // keys (e.g. renaming an agent touches the agent list, every per-agent view,
  // and the message log). The blast radius isn't statically knowable from the
  // path alone, so drop the whole GET cache — the next navigation refetches
  // fresh. Mutations are rare relative to reads, so this is cheap and correct.
  invalidateAll();
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Build a `/routing/:agent/suffix` path with proper URL-encoding of the agent name. */
export function routingPath(agentName: string, suffix = ''): string {
  const encoded = encodeURIComponent(agentName);
  return suffix
    ? `/routing/${encoded}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
    : `/routing/${encoded}`;
}
