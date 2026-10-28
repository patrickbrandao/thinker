import { signal } from '../lib/signal.js';
import { applyUserLocale, t } from '../i18n/index.js';
import { ApiError, BASE_URL } from './api/core.js';
import { invalidateAll } from './api/cache.js';
import { setActiveOrganization, type MeResponse } from './api/organizations.js';
import {
  getActiveOrganizationId,
  isPasswordChangeRequiredBody,
  markPasswordChangeRequired,
  setActiveOrganizationId,
  withOrganizationHeader,
} from './org-context.js';
import {
  canEditHarnesses,
  canManageMembers,
  canManageOrganization,
  canManageProviders,
} from './permissions.js';
import type { OrgRole } from './api/organizations.js';

/**
 * The signed-in user's identity in the active organization (`GET /me`).
 * Loaded once by the app shell (MeGate) before any page renders.
 */
export const me = signal<MeResponse | null>(null);
export const setMe = (value: MeResponse | null): void => me.set(value);

export const currentRole = (): OrgRole | null => me()?.organization?.role ?? null;
export const isInstanceAdmin = (): boolean => me()?.isInstanceAdmin === true;

// While /me is unknown (only outside the app shell, e.g. isolated component
// tests) nothing is hidden: the shell never renders pages before /me resolves,
// and the backend enforces roles regardless.
const allow = (check: (role: OrgRole | null) => boolean) => (): boolean => {
  const m = me();
  if (!m) return true;
  return check(m.organization?.role ?? null);
};

export const roleCan = {
  /** Create/edit harnesses and harness keys, use the playground. */
  editHarnesses: allow(canEditHarnesses),
  /** Providers, credentials, routing, notifications. */
  manageProviders: allow(canManageProviders),
  manageMembers: allow(canManageMembers),
  /** Rename/delete the organization. */
  manageOrganization: allow(canManageOrganization),
};

async function requestMe(): Promise<Response> {
  const headers = withOrganizationHeader();
  return fetch(`${BASE_URL}/me`, {
    credentials: 'include',
    cache: 'no-store',
    ...(headers ? { headers } : {}),
  });
}

/**
 * Loads `/me`. When the stored organization is refused (the user was removed
 * from it, or it was deleted) the choice is dropped and the call retried once,
 * so the backend falls back to the saved or first membership.
 */
export async function loadMe(): Promise<MeResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await requestMe();
    if (res.ok) {
      const body = (await res.json()) as MeResponse;
      setMe(body);
      applyUserLocale(body.userId);
      const stored = getActiveOrganizationId();
      if (body.organization && stored !== body.organization.id) {
        setActiveOrganizationId(body.organization.id);
      } else if (!body.organization && stored) {
        setActiveOrganizationId(null);
      }
      markPasswordChangeRequired(body.mustChangePassword === true);
      return body;
    }
    const body = (await res.json().catch(() => null)) as {
      code?: string;
      message?: string;
    } | null;
    if (res.status === 403 && isPasswordChangeRequiredBody(body)) {
      markPasswordChangeRequired();
      throw new ApiError('Password change required', 403, 'password_change_required');
    }
    if (attempt === 0 && (res.status === 403 || res.status === 404) && getActiveOrganizationId()) {
      setActiveOrganizationId(null);
      continue;
    }
    throw new ApiError(
      typeof body?.message === 'string'
        ? body.message
        : t('ui.errors.requestFailed', { status: res.status }),
      res.status,
      body?.code,
    );
  }
}

/** Paths that name an organization-scoped resource and won't exist in another org. */
const ORG_SCOPED_DETAIL = /^\/(harnesses\/|providers\/connections\/)/;

/**
 * Makes `organizationId` the active organization and reloads the dashboard so
 * every resource, cache and the SSE stream start over in the new scope.
 */
export async function switchOrganization(organizationId: string): Promise<void> {
  setActiveOrganizationId(organizationId);
  try {
    await setActiveOrganization(organizationId);
  } catch {
    // The header alone already scopes this tab; the saved default is a nicety.
  }
  invalidateAll();
  if (ORG_SCOPED_DETAIL.test(window.location.pathname)) {
    window.location.assign('/overview');
  } else {
    window.location.reload();
  }
}
