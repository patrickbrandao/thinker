import { fetchJson, fetchMutate } from './core.js';

/** `base`: the provider's path is appended to it; `url`: used as is. */
export type ProviderUrlKind = 'base' | 'url';

/** What the provider receives at this URL. */
export type ProviderUrlCredential = 'none' | 'access' | 'refresh' | 'secret';

/** One named URL of a provider (a "slot"), with its default for the account. */
export interface ProviderUrlSlotInfo {
  id: string;
  /** i18n key suffix of the slot's purpose (`providerSetup.urls.purpose.*`). */
  purpose: string;
  kind: ProviderUrlKind;
  credential: ProviderUrlCredential;
  /** The URL the account uses without an override; null when unknown. */
  default: string | null;
}

/** A slot of an existing connection: `value` null means the default. */
export interface ConnectionUrl extends ProviderUrlSlotInfo {
  value: string | null;
}

export interface ProviderUrlSlotsResponse {
  slots: ProviderUrlSlotInfo[];
}

/** Overrides sent when an account is created: slot id to URL (only changed slots). */
export type UrlOverrides = Record<string, string>;

/** URL slots of a provider for an account about to be added. */
export function getProviderUrlSlots(provider: string, authType: string, region?: string) {
  return fetchJson<ProviderUrlSlotsResponse>('/providers/url-slots', {
    provider,
    auth_type: authType,
    ...(region ? { region } : {}),
  });
}

/** Sets or clears (null = back to the default) URL overrides of a connection. */
export function setConnectionUrls(connectionId: string, overrides: Record<string, string | null>) {
  return fetchMutate<{ id: string; urls: ConnectionUrl[] }>(
    `/providers/connections/${encodeURIComponent(connectionId)}/urls`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides }),
    },
  );
}

/** `{ urlOverrides }` for a request body, or nothing when no slot changed. */
export function urlOverridesBody(overrides?: UrlOverrides): { urlOverrides?: UrlOverrides } {
  return overrides && Object.keys(overrides).length ? { urlOverrides: overrides } : {};
}

/** JSON request init carrying `urlOverrides`, or none when no slot changed. */
export function urlOverridesInit(overrides?: UrlOverrides): {
  body?: string;
  headers?: Record<string, string>;
} {
  const body = urlOverridesBody(overrides);
  return body.urlOverrides
    ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
    : {};
}
