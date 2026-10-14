import type { AuthType } from 'thinker-shared';
import { supportsSubscriptionProvider } from 'thinker-shared';

type ProviderAuthRecord = {
  provider: string;
  auth_type?: AuthType | null;
};

export function isSupportedSubscriptionProvider(provider: string): boolean {
  return supportsSubscriptionProvider(provider);
}

export function isThinkerUsableProvider(record: ProviderAuthRecord): boolean {
  return record.auth_type !== 'subscription' || isSupportedSubscriptionProvider(record.provider);
}
