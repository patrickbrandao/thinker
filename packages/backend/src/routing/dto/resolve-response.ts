import { ScoringReason } from '../../scoring';
import type {
  ModelRoute,
  ResponseMode,
  OutputModality,
  SpecificityCategory,
  TierSlot,
} from 'thinker-shared';

export type { AuthType } from 'thinker-shared';

export interface RouteParamsScope {
  route: ModelRoute;
  paramsScope: string;
}

export interface ResolveResponse {
  tier: TierSlot;
  confidence: number;
  score: number;
  reason: ScoringReason;
  /**
   * Resolved routing identity. Null when no model could be picked (no
   * provider connected, override invalidated, etc.). Replaces the legacy
   * flat `model` / `provider` / `auth_type` fields removed in this release;
   * read `route.model`, `route.provider`, `route.authType` instead.
   */
  route: ModelRoute | null;
  /**
   * Ordered fallback routes for the resolved tier. Null when none configured.
   * Replaces the legacy `fallback_models: string[]` field.
   */
  fallback_routes: ModelRoute[] | null;
  /** Effective output modality configured on the resolved routing chain. */
  output_modality?: OutputModality;
  /** Effective transport policy configured on the resolved routing chain. */
  response_mode?: ResponseMode;
  specificity_category?: SpecificityCategory;
  /** Virtual model the request named (ADR 0004). Set with reason `virtual-model`. */
  virtual_model_id?: string;
  /** The virtual model's name as the operator spelled it. */
  virtual_model_name?: string;
  /**
   * `agent_model_params` scope of each route of a virtual model's chain
   * (`virtual:<id>` for its own routes, `tier:default` for the ones appended
   * from the Default tier). Other origins use one scope for every route and
   * leave this unset.
   */
  route_params_scopes?: RouteParamsScope[];
  /**
   * Set when a virtual model matched but none of its routes is available. The
   * proxy turns it into M301 instead of falling through to other routing.
   */
  virtual_model_unavailable?: string;
  /**
   * With `virtual_model_unavailable`: whether the virtual model continues on
   * the Default tier, so M301 can say the Default had no route either.
   */
  virtual_model_continues_on_default?: boolean;
  /**
   * Model named by a pinned routing override that could not be resolved even
   * though its provider connection exists. The proxy turns this into M302
   * ("model not available") instead of M101 ("no model to route to").
   */
  override_model_unavailable?: string;
  /**
   * When `route` is null: one sentence saying which tier `auto` consulted and
   * what it is missing, appended to M101 so the operator knows what to set.
   */
  no_route_detail?: string;
}
