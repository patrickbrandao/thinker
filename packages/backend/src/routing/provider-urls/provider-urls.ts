/**
 * Editable URLs per account (ADR 0012, docs/dev/urls-por-conta.md): the one
 * place a connection's outbound URL is resolved.
 *
 * Rules: an override beats the region, the region beats the provider's
 * default (`defaultProviderUrl`). A protocol variant or the model listing
 * without an override of its own follows an overridden inference base
 * (`derivedFromSlot`). Overridden URLs go out through `fetchProviderUrl`
 * (SSRF revalidation, pinned address, no redirects).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PROVIDER_URL_MAX_LENGTH, providerUrlSlots, type ProviderUrlSlot } from 'thinker-shared';
import type { TenantContext } from '../../common/decorators/tenant-context.decorator';
import {
  allowsPrivateDestination,
  canUsePrivateDestinations,
} from '../../common/utils/private-url-policy';
import { validatePublicUrl } from '../../common/utils/url-validation';
import { emitAlert } from '../../common/services/alert-sink';
import type { TenantProvider } from '../../entities/tenant-provider.entity';
import { defaultProviderUrl, derivedFromSlot } from './provider-url-defaults';
import {
  builtInProviderUrl,
  canonicalUrlProvider,
  effectiveUrlOverrides,
  rebaseOnto,
  type ProviderUrlConnection,
  type ResolvedProviderUrl,
} from './provider-url-scope';

export * from './provider-url-scope';
export {
  defaultProviderUrl,
  derivedFromSlot,
  inferenceSlotForEndpoint,
} from './provider-url-defaults';

/**
 * The URL a connection uses for a slot: `{ url, overridden, allowPrivate }`,
 * or null when the slot has neither a default nor an override.
 */
export function resolveProviderUrl(
  conn: ProviderUrlConnection,
  slotId: string,
): ResolvedProviderUrl | null {
  const overrides = effectiveUrlOverrides(conn);
  const allowPrivate = allowsPrivateDestination(conn.allowPrivate);
  const own = overrides[slotId];
  if (own) return { url: own, overridden: true, allowPrivate };
  const fallback = defaultProviderUrl(conn.provider, conn.authType, conn.region, slotId);
  const parent = derivedFromSlot(conn.provider, slotId);
  const parentOverride = parent ? overrides[parent] : undefined;
  if (fallback && parent && parentOverride) {
    const parentDefault = defaultProviderUrl(conn.provider, conn.authType, conn.region, parent);
    const moved = parentDefault ? rebaseOnto(fallback, parentDefault, parentOverride) : null;
    if (moved) return { url: moved, overridden: true, allowPrivate };
  }
  return fallback ? builtInProviderUrl(fallback) : null;
}

/** A `tenant_providers` row as a URL connection. */
export function connectionUrls(
  row: Pick<
    TenantProvider,
    'provider' | 'auth_type' | 'region' | 'base_url' | 'url_overrides' | 'allow_private_destination'
  >,
): ProviderUrlConnection {
  return {
    provider: row.provider,
    authType: row.auth_type ?? 'api_key',
    region: row.region ?? null,
    urlOverrides: row.url_overrides ?? null,
    baseUrl: row.auth_type === 'api_key' ? (row.base_url ?? null) : null,
    allowPrivate: row.allow_private_destination,
  };
}

/** The slots a connection of this provider and auth type has (canonical id). */
export function urlSlotsFor(
  provider: string,
  authType: string | null | undefined,
): ProviderUrlSlot[] {
  return providerUrlSlots(canonicalUrlProvider(provider), authType ?? 'api_key');
}

export interface ProviderUrlSlotView {
  id: string;
  purpose: string;
  label: string;
  kind: ProviderUrlSlot['kind'];
  credential: ProviderUrlSlot['credential'];
  /** The URL used without an override (region and plan included). */
  default: string | null;
}

export interface ConnectionUrlView extends ProviderUrlSlotView {
  /** The connection's own value; null = the default. */
  value: string | null;
}

function slotView(
  slot: ProviderUrlSlot,
  provider: string,
  authType: string,
  region: string | null | undefined,
): ProviderUrlSlotView {
  return {
    id: slot.id,
    purpose: slot.purpose,
    label: slot.label,
    kind: slot.kind,
    credential: slot.credential,
    default: defaultProviderUrl(provider, authType, region, slot.id),
  };
}

/** `GET /api/v1/providers/url-slots`: the slots of an account that does not exist yet. */
export function urlSlotViews(
  provider: string,
  authType: string | null | undefined,
  region: string | null | undefined,
): ProviderUrlSlotView[] {
  const auth = authType ?? 'api_key';
  return urlSlotsFor(provider, auth).map((slot) => slotView(slot, provider, auth, region));
}

/** `urls` of a connection in the listings. */
export function connectionUrlViews(conn: ProviderUrlConnection): ConnectionUrlView[] {
  const auth = conn.authType ?? 'api_key';
  const overrides = effectiveUrlOverrides(conn);
  return urlSlotsFor(conn.provider, auth).map((slot) => ({
    ...slotView(slot, conn.provider, auth, conn.region),
    value: overrides[slot.id] ?? null,
  }));
}

/**
 * Trim and check one override: http(s), no credentials, at most 2048
 * characters, no fragment, and no query unless the slot is a `url` whose
 * default already carries one. Kept as typed, minus trailing slashes; a
 * `/v1` stays.
 */
export function normalizeProviderUrl(
  raw: string,
  slot: Pick<ProviderUrlSlot, 'id' | 'kind'>,
  defaultUrl: string | null,
): string {
  const value = raw.trim();
  const fail = (reason: string) => new BadRequestException(`URL for "${slot.id}" ${reason}`);
  if (value.length > PROVIDER_URL_MAX_LENGTH) throw fail('is too long');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw fail('must be a valid http(s) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw fail('must use http or https');
  if (url.username || url.password) throw fail('must not contain credentials');
  if (url.hash) throw fail('must not contain a fragment');
  const queryAllowed = slot.kind === 'url' && !!defaultUrl?.includes('?');
  if (url.search && !queryAllowed) throw fail('must not contain a query');
  return url.search ? value : value.replace(/\/+$/, '');
}

export interface UrlOverridesWrite {
  /** The connection's overrides after the change (only values that differ from the default). */
  overrides: Record<string, string>;
  /** Slots whose value changed. */
  changed: string[];
  /** What the private-URL policy allowed the caller (`allow_private_destination`). */
  allowPrivate: boolean;
}

/**
 * Validate a change of overrides (`null` = back to the default) for a
 * connection and merge it onto the current ones. Unknown slots are a 400;
 * subscription overrides need the organization owner or an instance admin;
 * every override left after the change is SSRF-checked with the caller's
 * private-destination policy.
 */
export async function checkUrlOverrides(
  conn: Pick<ProviderUrlConnection, 'provider' | 'authType' | 'region'>,
  current: Record<string, string>,
  changes: Record<string, string | null | undefined>,
  ctx: Pick<TenantContext, 'role' | 'isInstanceAdmin'>,
): Promise<UrlOverridesWrite> {
  const auth = conn.authType ?? 'api_key';
  const slots = new Map(urlSlotsFor(conn.provider, auth).map((slot) => [slot.id, slot]));
  const next = { ...current };
  const changed: string[] = [];
  for (const [slotId, raw] of Object.entries(changes ?? {})) {
    const slot = slots.get(slotId);
    if (!slot) {
      throw new BadRequestException(`Unknown URL slot "${slotId}" for ${conn.provider} (${auth})`);
    }
    const fallback = defaultProviderUrl(conn.provider, auth, conn.region, slotId);
    const value =
      raw === null || raw === undefined || raw.trim() === ''
        ? null
        : normalizeProviderUrl(raw, slot, fallback);
    // Only what differs from the default is stored.
    const stored = value && value !== fallback ? value : null;
    if ((next[slotId] ?? null) === stored) continue;
    if (stored) next[slotId] = stored;
    else delete next[slotId];
    changed.push(slotId);
  }
  if (changed.length > 0 && auth === 'subscription' && !canEditSubscriptionUrls(ctx)) {
    throw new ForbiddenException(
      "Only the organization owner or an instance admin can change a subscription's URLs",
    );
  }
  const allowPrivate = canUsePrivateDestinations(ctx);
  for (const [slotId, url] of Object.entries(next)) {
    try {
      await validatePublicUrl(url, { allowPrivate });
    } catch (err) {
      throw new BadRequestException(`URL for "${slotId}": ${(err as Error).message}`);
    }
  }
  return { overrides: next, changed, allowPrivate };
}

/** Owner of the organization or instance admin (ADR 0012 item 3). */
export function canEditSubscriptionUrls(
  ctx: Pick<TenantContext, 'role' | 'isInstanceAdmin'>,
): boolean {
  // Internal contexts (no role at all) are not user credentials.
  if (ctx.role === undefined) return true;
  return ctx.isInstanceAdmin === true || ctx.role === 'owner';
}

/**
 * The `urlOverrides` a client sent: an object of strings, or a JSON-encoded
 * one (the GET authorize endpoints take it as a query parameter).
 */
export function parseUrlOverridesInput(input: unknown): Record<string, string | null> | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new BadRequestException('urlOverrides must be a JSON object');
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('urlOverrides must be an object of slot id to URL');
  }
  const out: Record<string, string | null> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== null && typeof v !== 'string') {
      throw new BadRequestException(`urlOverrides.${key} must be a string or null`);
    }
    out[key] = v as string | null;
  }
  return out;
}

/**
 * Overrides for a subscription login that does not exist yet: validated
 * against the provider's subscription slots, for the in-flow calls and the
 * account created at the end. Undefined when nothing was sent.
 */
export async function flowUrlConnection(
  provider: string,
  region: string | null | undefined,
  input: unknown,
  ctx: Pick<TenantContext, 'role' | 'isInstanceAdmin'>,
): Promise<ProviderUrlConnection | undefined> {
  const changes = parseUrlOverridesInput(input);
  if (!changes) return undefined;
  const { overrides, allowPrivate } = await checkUrlOverrides(
    { provider, authType: 'subscription', region },
    {},
    changes,
    ctx,
  );
  if (Object.keys(overrides).length === 0) return undefined;
  return { provider, authType: 'subscription', region, urlOverrides: overrides, allowPrivate };
}

/**
 * Audit alert `provider.urls_changed`: who, which connection and which
 * slots. Never the URLs' credentials (there are none in a stored URL) and
 * never a token.
 */
export function emitUrlsChangedAlert(input: {
  tenantId: string;
  userId?: string | null;
  connection: { id: string; provider: string; auth_type?: string | null; label: string };
  changed: string[];
}): void {
  if (input.changed.length === 0) return;
  const { connection } = input;
  emitAlert({
    tenantId: input.tenantId,
    level: connection.auth_type === 'subscription' ? 'warning' : 'info',
    type: 'provider.urls_changed',
    title: `Connection ${connection.provider} / ${connection.label} URLs changed`,
    message: `Slots: ${input.changed.join(', ')}`,
    entityType: 'connection',
    entityId: connection.id,
    entityName: `${connection.provider} / ${connection.label}`,
    actorUserId: input.userId ?? null,
    metadata: {
      provider: connection.provider,
      auth_type: connection.auth_type ?? 'api_key',
      slots: input.changed,
    },
  });
}
