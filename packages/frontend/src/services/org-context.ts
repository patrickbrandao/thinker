import { signal } from '../lib/signal.js';

/**
 * Active-organization plumbing shared by every dashboard API call (ADR 0006).
 *
 * The chosen organization id lives in localStorage and travels on every
 * `/api/v1` request as `X-Thinker-Organization`. When nothing is stored the
 * header is omitted and the backend falls back to the user's saved active
 * organization or first membership.
 *
 * This module has no imports from the API layer so the API core can use it
 * without an import cycle.
 */

export const ORGANIZATION_HEADER = 'X-Thinker-Organization';
const STORAGE_KEY = 'thinker.activeOrganization';

export function getActiveOrganizationId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveOrganizationId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): the backend fallback still applies.
  }
}

/**
 * Returns `headers` with the active-organization header added. With no active
 * organization the input is returned untouched, so callers that pass a plain
 * object keep getting a plain object back.
 */
export function withOrganizationHeader(headers?: HeadersInit): HeadersInit | undefined {
  const orgId = getActiveOrganizationId();
  if (!orgId) return headers;
  let plain: Record<string, string>;
  if (!headers) plain = {};
  else if (headers instanceof Headers) plain = Object.fromEntries(headers.entries());
  else if (Array.isArray(headers)) plain = Object.fromEntries(headers);
  else plain = { ...(headers as Record<string, string>) };
  plain[ORGANIZATION_HEADER] = orgId;
  return plain;
}

// Raised by the API layer when the backend answers 403 password_change_required.
// The app shell watches it and routes to /change-password.
export const passwordChangeRequired = signal(false);

export function markPasswordChangeRequired(value = true): void {
  passwordChangeRequired.set(value);
}

/** True when a parsed error body is the backend's forced-password-change refusal. */
export function isPasswordChangeRequiredBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { code?: unknown }).code === 'password_change_required'
  );
}
