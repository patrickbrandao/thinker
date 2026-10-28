import { fetchJson, fetchMutate, routingPath } from './core.js';
import type {
  CreateVirtualModelRequest,
  ModelRoute,
  ResponseMode,
  UpdateVirtualModelRequest,
  VirtualModelView,
} from 'thinker-shared';

/**
 * Admin API for virtual models (ADR 0004): `/api/v1/routing/:agent/virtual-models`.
 * Chain fields plus `continue_on_default` and the
 * `shadows` / `context_length` values the backend computes on read.
 */
export type VirtualModel = VirtualModelView;
export type { CreateVirtualModelRequest, UpdateVirtualModelRequest };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function itemPath(agentName: string, id: string, suffix = ''): string {
  return routingPath(agentName, `virtual-models/${encodeURIComponent(id)}${suffix}`);
}

export function listVirtualModels(agentName: string) {
  return fetchJson<VirtualModel[]>(routingPath(agentName, 'virtual-models'));
}

/**
 * Create a virtual model. Silent: the create modal shows the backend message
 * inline (name field or the offending route) instead of a toast.
 */
export function createVirtualModel(agentName: string, input: CreateVirtualModelRequest) {
  return fetchMutate<VirtualModel>(
    routingPath(agentName, 'virtual-models'),
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
    { silent: true },
  );
}

/** Edit name, `continue_on_default` or `output_modality`. Silent, as create. */
export function updateVirtualModel(
  agentName: string,
  id: string,
  patch: UpdateVirtualModelRequest,
  options?: { silent?: boolean },
) {
  return fetchMutate<VirtualModel>(
    itemPath(agentName, id),
    { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) },
    { silent: options?.silent ?? true },
  );
}

export function toggleVirtualModel(agentName: string, id: string, enabled: boolean) {
  return fetchMutate<VirtualModel>(itemPath(agentName, id, '/toggle'), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled }),
  });
}

/** Silent on request, for the edit modal, which shows the message inline. */
export function setVirtualModelResponseMode(
  agentName: string,
  id: string,
  responseMode: ResponseMode,
  options?: { silent?: boolean },
) {
  return fetchMutate<VirtualModel>(
    itemPath(agentName, id, '/response-mode'),
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ response_mode: responseMode }),
    },
    { silent: options?.silent ?? false },
  );
}

export function deleteVirtualModel(agentName: string, id: string) {
  return fetchMutate(itemPath(agentName, id), { method: 'DELETE' });
}

export function reorderVirtualModels(agentName: string, ids: string[]) {
  return fetchMutate(routingPath(agentName, 'virtual-models/reorder'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ids }),
  });
}

/** A structured `route` wins when present. */
export function setVirtualModelOverride(
  agentName: string,
  id: string,
  model: string,
  provider: string,
  authType?: ModelRoute['authType'],
  providerKeyLabel?: string,
) {
  const body: Record<string, unknown> = { model, provider };
  if (authType) {
    body.authType = authType;
    body.route = providerKeyLabel
      ? { provider, authType, model, keyLabel: providerKeyLabel }
      : { provider, authType, model };
  }
  if (providerKeyLabel) body.providerKeyLabel = providerKeyLabel;
  return fetchMutate<VirtualModel>(itemPath(agentName, id, '/override'), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** Clears the primary and, as for header tiers, the fallbacks behind it. */
export function clearVirtualModelOverride(agentName: string, id: string) {
  return fetchMutate(itemPath(agentName, id, '/override'), { method: 'DELETE' });
}

export function setVirtualModelFallbacks(
  agentName: string,
  id: string,
  models: string[],
  routes?: ModelRoute[],
) {
  const body: Record<string, unknown> = { models };
  if (routes && routes.length === models.length) body.routes = routes;
  return fetchMutate<ModelRoute[]>(itemPath(agentName, id, '/fallbacks'), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function clearVirtualModelFallbacks(agentName: string, id: string) {
  return fetchMutate(itemPath(agentName, id, '/fallbacks'), { method: 'DELETE' });
}

/** One row of a harness's Models tab, in `GET /v1/models` order. */
export interface HarnessModelEntry {
  id: string;
  kind: 'auto' | 'virtual' | 'model';
  owned_by: string;
  context_length: number | null;
  display_name?: string;
  provider?: string;
  provider_model_id?: string;
  auth_type?: string;
  input_price_per_token?: number | null;
  output_price_per_token?: number | null;
  reasoning?: boolean;
  code?: boolean;
  input_modalities?: string[];
  output_modalities?: string[];
  primary?: ModelRoute | null;
  fallbacks?: ModelRoute[];
  continue_on_default?: boolean;
  response_mode?: ResponseMode;
}

export interface HarnessModelList {
  listing: 'open' | 'restricted' | 'closed';
  data: HarnessModelEntry[];
}

/** What this harness's `GET /v1/models` lists, with details for the dashboard. */
export function getHarnessModelList(agentName: string) {
  return fetchJson<HarnessModelList>(routingPath(agentName, 'model-list'));
}
