import type { ModelRoute } from 'thinker-shared';
import type { TenantProvider } from '../../entities/tenant-provider.entity';
import type { VirtualModel } from '../../entities/virtual-model.entity';

/** A virtual model whose own chain points at a provider connection. */
export interface AffectedVirtualModel {
  id: string;
  name: string;
  agent: string;
  /** `primary` (the override route) or `fallback N` (1-based). */
  position: string;
  model: string;
}

/**
 * Predicate for "this route runs on this provider connection", as the
 * per-harness disable guard has always judged it (REST controller and MCP tool
 * share it, so the two surfaces cannot drift).
 */
export function makeAgentProviderRouteMatcher(
  provider: TenantProvider,
): (route: ModelRoute | null | undefined) => boolean {
  const providerModels = new Set(
    (Array.isArray(provider.cached_models) ? provider.cached_models : []).map((m) => m.id),
  );
  const providerName = provider.provider.toLowerCase();
  const providerAuthType = provider.auth_type;
  const providerLabel = provider.label?.toLowerCase();
  return (route) => {
    if (!route) return false;
    if (route.provider) {
      if (route.provider.toLowerCase() !== providerName) return false;
      if (route.authType && route.authType !== providerAuthType) return false;
      if (route.keyLabel && providerLabel && route.keyLabel.toLowerCase() !== providerLabel) {
        return false;
      }
      if (!route.keyLabel && provider.priority !== 0 && providerLabel !== 'default') return false;
      return true;
    }
    return providerModels.has(route.model);
  };
}

/**
 * Virtual models whose override or fallback routes use the provider. Enabled
 * and disabled rows both count: a disabled row keeps its chain and would come
 * back with a dangling route when re-enabled. Routes a virtual inherits from
 * the Default tier (`continue_on_default`) are not stored on the row, so they
 * are not counted here; the tier guard already protects them.
 */
export function collectAffectedVirtualModels(
  virtualModels: readonly Pick<
    VirtualModel,
    'id' | 'name' | 'override_route' | 'fallback_routes'
  >[],
  agentName: string,
  belongs: (route: ModelRoute | null | undefined) => boolean,
): AffectedVirtualModel[] {
  const affected: AffectedVirtualModel[] = [];
  for (const vm of virtualModels) {
    if (belongs(vm.override_route)) {
      affected.push({
        id: vm.id,
        name: vm.name,
        agent: agentName,
        position: 'primary',
        model: vm.override_route!.model,
      });
    }
    for (const [i, fallback] of (vm.fallback_routes ?? []).entries()) {
      if (!belongs(fallback)) continue;
      affected.push({
        id: vm.id,
        name: vm.name,
        agent: agentName,
        position: `fallback ${i + 1}`,
        model: fallback.model,
      });
    }
  }
  return affected;
}

export const AGENT_DISABLE_BLOCKED_MESSAGE =
  "Can't disable provider while its models are assigned to this harness's routing. Update routing first.";

/**
 * The 409 text for a blocked per-harness disable. Tier usage keeps the
 * historical message; virtual-only usage names the first virtual model.
 */
export function agentDisableBlockedMessage(
  tierCount: number,
  virtuals: readonly AffectedVirtualModel[],
): string {
  if (tierCount > 0 || virtuals.length === 0) return AGENT_DISABLE_BLOCKED_MESSAGE;
  const first = virtuals[0];
  return (
    "Can't disable provider while its models are assigned to this harness's routing. " +
    `Update routing first (agent "${first.agent}", virtual model "${first.name}", ` +
    `${first.position}: ${first.model}).`
  );
}
