import { BadRequestException } from '@nestjs/common';
import type { TenantContext } from '../common/decorators/tenant-context.decorator';
import { canUsePrivateDestinations } from '../common/utils/private-url-policy';
import { validatePublicUrl } from '../common/utils/url-validation';
import type { TenantProvider } from '../entities/tenant-provider.entity';
import {
  defaultAccountBaseUrl,
  normalizeAccountBaseUrl,
  supportsAccountBaseUrl,
} from './account-base-url';

/**
 * Normalize a base URL sent by a user and apply the custom-provider rules:
 * SSRF validation, with private/LAN destinations allowed only as
 * THINKER_PROVIDER_PRIVATE_URLS says for this caller. Null/empty clears it.
 */
export async function checkAccountBaseUrl(
  raw: string | null | undefined,
  ctx: Pick<TenantContext, 'role' | 'isInstanceAdmin'>,
): Promise<string | null> {
  let url: string | null;
  try {
    url = normalizeAccountBaseUrl(raw);
  } catch (err) {
    throw new BadRequestException((err as Error).message);
  }
  if (!url) return null;
  try {
    await validatePublicUrl(url, { allowPrivate: canUsePrivateDestinations(ctx) });
  } catch (err) {
    throw new BadRequestException((err as Error).message);
  }
  return url;
}

/** Base URL fields of a connection for the dashboard. */
export function baseUrlFields(
  p: Pick<TenantProvider, 'provider' | 'auth_type' | 'region' | 'base_url'>,
) {
  const supports = supportsAccountBaseUrl(p.provider, p.auth_type);
  return {
    region: p.region ?? null,
    base_url: supports ? (p.base_url ?? null) : null,
    default_base_url: supports ? defaultAccountBaseUrl(p.provider, p.auth_type, p.region) : null,
    supports_base_url: supports,
  };
}
