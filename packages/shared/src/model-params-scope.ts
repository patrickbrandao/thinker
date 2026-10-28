export function modelParamsScopeForTier(tier: string): string {
  return `tier:${tier}`;
}

export function modelParamsScopeForSpecificity(category: string): string {
  return `specificity:${category}`;
}

/**
 * Scope of the routes of a virtual model's own chain (ADR 0004). Routes the
 * chain borrows from the Default tier keep `tier:default`.
 */
export function modelParamsScopeForVirtualModel(virtualModelId: string): string {
  return `virtual:${virtualModelId}`;
}

export interface ModelParamsRoutingScopeInput {
  tier: string;
  specificityCategory?: string;
}

export function modelParamsScopeForRouting(input: ModelParamsRoutingScopeInput): string {
  if (input.specificityCategory) return modelParamsScopeForSpecificity(input.specificityCategory);
  return modelParamsScopeForTier(input.tier);
}
