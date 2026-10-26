import { validateVirtualModelName } from 'thinker-shared';
import type { AvailableModel, ModelRoute } from './api.js';
import { ApiError } from './api/core.js';

/**
 * Pure helpers behind the virtual model create/edit modal (ADR 0004). The
 * name rule itself comes from `thinker-shared`, the same function the backend
 * runs, so the live message matches the one a 400 would carry.
 */

/** Live name check: the shared rule plus uniqueness among the agent's virtual models. */
export function virtualModelNameError(
  raw: string,
  otherNames: readonly string[],
): string | undefined {
  const result = validateVirtualModelName(raw);
  if (!result.ok) return result.error;
  const lower = result.name.toLowerCase();
  if (otherNames.some((n) => n.toLowerCase() === lower)) {
    return 'Another virtual model on this harness already uses this name';
  }
  return undefined;
}

/**
 * Preview of the real ids a name would shadow, from the catalog the page has
 * loaded: native model ids and `provider/model` ids, ignoring case. The
 * backend's `shadows` list (computed on every read) is authoritative; this
 * only warns while typing, before the name is saved.
 */
export function previewShadows(name: string, models: readonly AvailableModel[]): string[] {
  const lower = name.trim().toLowerCase();
  if (!lower) return [];
  const found = new Set<string>();
  for (const m of models) {
    if (m.model_name.toLowerCase() === lower) found.add(m.model_name);
    const prefixed = `${m.provider.toLowerCase()}/${m.model_name}`;
    if (prefixed.toLowerCase() === lower) found.add(prefixed);
  }
  return [...found].sort();
}

/** Routes of a chain that cannot stream, by their catalog capabilities. */
export function nonStreamingRoutes(
  routes: readonly { route: Pick<ModelRoute, 'model'>; position: string }[],
  models: readonly AvailableModel[],
): { model: string; position: string }[] {
  const streams = (model: string) =>
    models.find((m) => m.model_name === model)?.capabilities?.includes('stream') ?? false;
  return routes
    .filter(({ route }) => !streams(route.model))
    .map(({ route, position }) => ({ model: route.model, position }));
}

export interface VirtualModelFormErrors {
  /** Shown under the name field. */
  name?: string;
  /** Shown above the footer when the message is not about the name. */
  general?: string;
  /** Chain models the message names, to highlight their rows. */
  invalidModels: string[];
}

const NAME_MESSAGE = /^name\b|"auto" is reserved|virtual model named/i;

/**
 * Turn a failed create/update into messages placed where they belong: a 409
 * (duplicate name) or a name-rule 400 goes under the name field; a 400 that
 * names one of the chain's models (an unresolved primary or fallback, or an
 * unknown key) highlights that row and keeps the backend wording.
 */
export function mapVirtualModelError(
  err: unknown,
  chainModels: readonly string[],
): VirtualModelFormErrors {
  const message =
    err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.';
  const status = err instanceof ApiError ? err.status : undefined;
  if (status === 409 || (status === 400 && NAME_MESSAGE.test(message))) {
    return { name: message, invalidModels: [] };
  }
  const quoted = [...message.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const invalidModels = chainModels.filter((model) => quoted.includes(model));
  return { general: message, invalidModels };
}
