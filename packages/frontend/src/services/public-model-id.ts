import type { AuthType, CustomProviderData } from './api.js';

/**
 * Public model ids, as the backend's `openAiModelId` builds them
 * (`routing-core/public-model-id.ts`): the names Thinker publishes in
 * `/v1/models` and accepts back from clients.
 */
const SUBSCRIPTION_SUFFIX = '-subscription';

export interface PublicModelIdInput {
  model: string;
  provider: string;
  authType?: AuthType | string | null;
}

/** `custom:<uuid>` -> alias, for the custom providers that have one. */
export function customProviderAliases(
  customProviders: readonly Pick<CustomProviderData, 'id' | 'alias'>[] = [],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const cp of customProviders) if (cp.alias) map.set(`custom:${cp.id}`, cp.alias);
  return map;
}

/**
 * - custom provider: `<alias>/<model>` with an alias, the internal
 *   `custom:<uuid>/<model>` otherwise;
 * - subscription: `<provider>/<model>-subscription`;
 * - anything else: `<provider>/<model>`.
 */
export function publicModelId(
  input: PublicModelIdInput,
  aliases: ReadonlyMap<string, string> = new Map(),
): string {
  const { model } = input;
  if (input.provider.toLowerCase().startsWith('custom:')) {
    const alias = aliases.get(input.provider);
    const prefix = `${input.provider}/`;
    if (!alias) return model;
    return `${alias}/${model.startsWith(prefix) ? model.slice(prefix.length) : model}`;
  }
  const provider = input.provider.toLowerCase();
  const prefix = `${provider}/`;
  const routeId = model.toLowerCase().startsWith(prefix) ? model : `${provider}/${model}`;
  if (input.authType !== 'subscription') return routeId;
  if (model === 'auto') return model;
  return routeId.endsWith(SUBSCRIPTION_SUFFIX) ? routeId : `${routeId}${SUBSCRIPTION_SUFFIX}`;
}
