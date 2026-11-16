import type { TenantProvider } from '../../../entities/tenant-provider.entity';
import type { ProviderService } from '../../routing-core/provider.service';
import {
  emitUrlsChangedAlert,
  type ProviderUrlConnection,
} from '../../provider-urls/provider-urls';

/**
 * Store the URL overrides a login was started with (ADR 0012) on the account
 * it created, before its first model discovery. A no-op without overrides.
 */
export async function applyFlowUrls(
  providerService: Pick<ProviderService, 'setUrlOverrides'>,
  saved: TenantProvider,
  urls: ProviderUrlConnection | null | undefined,
  userId?: string | null,
): Promise<TenantProvider> {
  const overrides = urls?.urlOverrides;
  if (!overrides || Object.keys(overrides).length === 0) return saved;
  const updated = await providerService.setUrlOverrides(
    saved.tenant_id,
    saved.id,
    overrides,
    urls.allowPrivate !== false,
  );
  emitUrlsChangedAlert({
    tenantId: saved.tenant_id,
    userId: userId ?? null,
    connection: updated ?? saved,
    changed: Object.keys(overrides),
  });
  return updated ?? saved;
}
