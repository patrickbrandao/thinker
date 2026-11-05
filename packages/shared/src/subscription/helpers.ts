import type { SubscriptionCapabilities, SubscriptionProviderConfig } from './types';
import { SUBSCRIPTION_PROVIDER_CONFIGS } from './configs';
import { normalizeProviderName, SHARED_PROVIDER_BY_ID_OR_ALIAS } from '../providers';

function normalizeProviderId(providerId: string): string {
  const lower = String(providerId || '')
    .trim()
    .toLowerCase();
  const entry =
    SHARED_PROVIDER_BY_ID_OR_ALIAS.get(lower) ??
    SHARED_PROVIDER_BY_ID_OR_ALIAS.get(normalizeProviderName(lower));
  return entry?.id ?? lower;
}

export function getSubscriptionProviderConfig(
  providerId: string,
): Readonly<SubscriptionProviderConfig> | null {
  const id = normalizeProviderId(providerId);
  if (!Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PROVIDER_CONFIGS, id)) return null;
  return SUBSCRIPTION_PROVIDER_CONFIGS[id as keyof typeof SUBSCRIPTION_PROVIDER_CONFIGS] ?? null;
}

export function supportsSubscriptionProvider(providerId: string): boolean {
  return getSubscriptionProviderConfig(providerId) !== null;
}

export function getSubscriptionKnownModels(providerId: string): readonly string[] | null {
  const config = getSubscriptionProviderConfig(providerId);
  return config?.knownModels ?? null;
}

export function getSubscriptionKnownModelsMatch(providerId: string): 'prefix' | 'exact' {
  const config = getSubscriptionProviderConfig(providerId);
  return config?.knownModelsMatch ?? 'prefix';
}

export function getSubscriptionCapabilities(
  providerId: string,
): Readonly<SubscriptionCapabilities> | null {
  const config = getSubscriptionProviderConfig(providerId);
  return config?.subscriptionCapabilities ?? null;
}
