import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { openAiModelId } from '../proxy/openai-model-id';
import { catalogModelMatchesRoute } from './model-list-scope';
import type { ModelListRouting } from './model-list-routing.service';

/** A real catalog model as `/v1/models` lists it, after `auto` and the virtuals. */
export interface ListedCatalogModel {
  id: string;
  model: DiscoveredModel;
}

/**
 * The real models `/v1/models` publishes, in order: the listing mode
 * (`closed` lists none, `restricted` only the ones the routes reach), one
 * entry per public id, and no id an enabled virtual model shadows (ADR 0004,
 * sections 6 and 7). Shared by the proxy and the dashboard's Models tab.
 */
export function listedCatalogModels(
  models: readonly DiscoveredModel[],
  routing: ModelListRouting,
): ListedCatalogModel[] {
  const seen = new Set(['auto', ...routing.virtuals.map((v) => v.name)]);
  const shadowed = new Set(routing.virtuals.map((v) => v.name.toLowerCase()));
  const listing = routing.listing ?? 'open';
  const linkedRoutes = routing.linkedRoutes ?? [];
  const candidates =
    listing === 'closed'
      ? []
      : listing === 'restricted'
        ? models.filter((model) =>
            linkedRoutes.some((route) => catalogModelMatchesRoute(model, route)),
          )
        : models;

  const out: ListedCatalogModel[] = [];
  for (const model of candidates) {
    const id = openAiModelId(model);
    if (seen.has(id) || shadowed.has(id.toLowerCase())) continue;
    seen.add(id);
    out.push({ id, model });
  }
  return out;
}
