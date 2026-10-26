import type { AuthType } from './auth-types';
import type { ModelRoute } from './model-route';
import type { OutputModality } from './output-modality';
import type { ResponseMode } from './response-mode';

/**
 * Virtual models (ADR 0004): public model names an operator creates on a
 * harness. Each one carries its own chain of concrete routes and is matched
 * by the `model` field of a proxy request.
 */

export const VIRTUAL_MODEL_NAME_MAX_LENGTH = 64;

/**
 * Segments of `[A-Za-z0-9._:-]` joined by single slashes: no leading or
 * trailing slash and no `//`. The segment class excludes `/`, so the pattern
 * matches in linear time.
 */
export const VIRTUAL_MODEL_NAME_PATTERN = /^[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)*$/;

export const VIRTUAL_MODEL_NAME_MESSAGE =
  'Name can only contain letters, numbers, dots, underscores, colons, hyphens and single slashes, and cannot start or end with a slash';

/** Most fallbacks a virtual model can carry, as for tiers. */
export const MAX_VIRTUAL_MODEL_FALLBACKS = 5;

/** `auto` routes through the agent's tiers, in any spelling. */
export function isReservedVirtualModelName(name: string): boolean {
  return name.trim().toLowerCase() === 'auto';
}

export type VirtualModelNameValidation = { ok: true; name: string } | { ok: false; error: string };

/**
 * Validate a virtual model name as typed by the operator. Surrounding
 * whitespace is trimmed; the stored name keeps the operator's casing.
 * Uniqueness per agent is checked by the backend.
 */
export function validateVirtualModelName(raw: unknown): VirtualModelNameValidation {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return { ok: false, error: 'Name is required' };
  if (name.length > VIRTUAL_MODEL_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Name must be ${VIRTUAL_MODEL_NAME_MAX_LENGTH} characters or fewer`,
    };
  }
  if (!VIRTUAL_MODEL_NAME_PATTERN.test(name)) {
    return { ok: false, error: VIRTUAL_MODEL_NAME_MESSAGE };
  }
  if (isReservedVirtualModelName(name)) {
    return { ok: false, error: '"auto" is reserved and cannot be used as a virtual model name' };
  }
  return { ok: true, name };
}

/** A virtual model as the admin API returns it. */
export interface VirtualModel {
  id: string;
  agent_id: string;
  name: string;
  sort_order: number;
  enabled: boolean;
  override_route: ModelRoute | null;
  fallback_routes: ModelRoute[] | null;
  continue_on_default: boolean;
  response_mode: ResponseMode;
  output_modality: OutputModality;
  created_at: string;
  updated_at: string;
}

/** A virtual model plus the values the API computes on read. */
export interface VirtualModelView extends VirtualModel {
  /**
   * Public and native model ids of the agent's current catalog that match
   * the name, ignoring case. While the virtual model is enabled, requests
   * for these ids route through it instead. Computed on every read because
   * the catalog changes as providers come and go; listed whatever the
   * `enabled` flag, so the dashboard can warn before the model is enabled.
   */
  shadows: string[];
  /**
   * Smallest context window among the available routes of the effective
   * chain (with the Default chain when `continue_on_default` is on). Null
   * when the chain is empty or any of its routes has an unknown window.
   */
  context_length: number | null;
}

/** A route as a client sends it: only the model name is required. */
export interface VirtualModelRouteInput {
  model: string;
  provider?: string;
  authType?: AuthType;
  keyLabel?: string | null;
}

export interface CreateVirtualModelRequest {
  name: string;
  override_route?: VirtualModelRouteInput | null;
  fallback_routes?: VirtualModelRouteInput[];
  continue_on_default?: boolean;
  response_mode?: ResponseMode;
  output_modality?: OutputModality;
}

export interface UpdateVirtualModelRequest {
  name?: string;
  continue_on_default?: boolean;
  output_modality?: OutputModality;
}

export interface ToggleVirtualModelRequest {
  enabled: boolean;
}

export interface ReorderVirtualModelsRequest {
  ids: string[];
}

/** Same shape as the header-tier override body. `route` wins when present. */
export interface SetVirtualModelOverrideRequest {
  model: string;
  provider?: string;
  authType?: AuthType;
  providerKeyLabel?: string;
  route?: ModelRoute;
}

/** Same shape as the header-tier fallbacks body. */
export interface SetVirtualModelFallbacksRequest {
  models: string[];
  routes?: ModelRoute[];
}
