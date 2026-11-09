import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { publishableContextWindow } from '../../model-discovery/model-fetcher';

/** OpenRouter's random router across its `:free` models. */
export const OPENROUTER_FREE_ROUTER_ID = 'openrouter/free';

function isOpenRouterFreeRouter(model: Pick<DiscoveredModel, 'id' | 'provider'>): boolean {
  return (
    model.provider.toLowerCase() === 'openrouter' &&
    model.id.toLowerCase() === OPENROUTER_FREE_ROUTER_ID
  );
}

/**
 * The context window a catalog model publishes (`/v1/models` and the
 * smallest window of `auto`/virtual chains). `openrouter/free` answers with
 * any of the connection's `:free` models, so it publishes the smallest of
 * theirs (null when there is none). Everything else: its own window, unless
 * it is a stand-in default or implausible.
 */
export function publishedContextWindow(
  model: DiscoveredModel,
  connectionModels: readonly DiscoveredModel[],
): number | null {
  if (!isOpenRouterFreeRouter(model)) return publishableContextWindow(model);
  let min: number | null = null;
  for (const candidate of connectionModels) {
    if (candidate.provider.toLowerCase() !== 'openrouter') continue;
    if (!candidate.id.toLowerCase().endsWith(':free')) continue;
    const window = publishableContextWindow(candidate);
    if (window !== null && (min === null || window < min)) min = window;
  }
  return min;
}
