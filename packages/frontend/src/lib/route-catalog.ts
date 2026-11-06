import type { AuthType, AvailableModel } from '../services/api.js';
import { inferProviderFromModel } from 'thinker-shared';
import { resolveProviderId } from '../services/routing-utils.js';
import { PROVIDERS } from '../services/providers.js';

interface RouteIdentity {
  provider: string;
  authType: AuthType;
  model: string;
}

const isKnown = (id: string | undefined): id is string =>
  !!id && PROVIDERS.some((p) => p.id === id);

/**
 * Provider ids a discovered model can be routed under: its own connection's
 * id, and the group the model picker files it under (an OpenRouter
 * `anthropic/...` row is offered under Anthropic). Mirrors ModelPickerModal.
 */
function providerIdsFor(m: AvailableModel): string[] {
  const dbProvId = resolveProviderId(m.provider);
  const prefixProvId = inferProviderFromModel(m.model_name);
  const pickerProvId =
    dbProvId && dbProvId !== 'openrouter' && isKnown(dbProvId)
      ? dbProvId
      : isKnown(prefixProvId)
        ? prefixProvId
        : (dbProvId ?? prefixProvId);
  return [dbProvId ?? m.provider.toLowerCase(), pickerProvId]
    .filter((id): id is string => !!id)
    .map((id) => id.toLowerCase());
}

/**
 * True when a route points to a model its connection no longer lists, so the
 * proxy skips it. Never true while the list is loading or empty for that
 * provider and auth type (cold discovery): only a loaded, non-empty list
 * missing the model counts.
 */
export function routeNotInCatalog(
  route: RouteIdentity | null | undefined,
  models: readonly AvailableModel[],
): boolean {
  if (!route?.provider || !route.model) return false;
  const routeProvider = (resolveProviderId(route.provider) ?? route.provider).toLowerCase();
  const listed = models.filter(
    (m) =>
      (!m.auth_type || m.auth_type === route.authType) && providerIdsFor(m).includes(routeProvider),
  );
  if (listed.length === 0) return false;
  return !listed.some((m) => m.model_name === route.model);
}
