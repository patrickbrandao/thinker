import { useState } from 'react';
import { modelParamsScopeForTier } from 'thinker-shared';
import {
  clearFallbacks,
  overrideTier,
  resetTier,
  setFallbacks,
  type AuthType,
  type AvailableModel,
  type CustomProviderData,
  type ModelRoute,
  type RequestParamDefaults,
  type RoutingProvider,
  type TierAssignment,
} from '../services/api.js';
import RouteChainCard from '../components/RouteChainCard.js';
import VirtualModelTitle from '../components/VirtualModelTitle.js';
import VirtualModelSnippetModal from '../components/VirtualModelSnippetModal.js';

const TIER = 'default';

export interface AutoChainCardProps {
  agentName: string;
  tier: TierAssignment | undefined;
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  connectedProviders: RoutingProvider[];
  /** Refetches the tiers after a save. */
  reloadTiers: () => void | Promise<unknown>;
  getModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
  ) => RequestParamDefaults | null;
  setModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
    params: RequestParamDefaults | null,
  ) => Promise<unknown>;
}

/**
 * The `auto` model (the agent's default tier) as a read-only route chain, like
 * the virtual models: the chain is edited only in the "Manage model" window.
 */
export default function AutoChainCard(props: AutoChainCardProps) {
  const [showExample, setShowExample] = useState(false);
  const tier = props.tier;

  return (
    <>
      <RouteChainCard
        agentName={props.agentName}
        chain={{
          id: TIER,
          name: 'auto',
          override_route: tier?.override_route ?? null,
          fallback_routes: tier?.fallback_routes ?? null,
          response_mode: tier?.response_mode,
        }}
        cardClass="routing-card--auto"
        models={props.models}
        customProviders={props.customProviders}
        connectedProviders={props.connectedProviders}
        titleContent={<VirtualModelTitle name="auto" onShowExample={() => setShowExample(true)} />}
        onOverride={async (model, provider, authType, keyLabel) => {
          try {
            await overrideTier(props.agentName, TIER, model, provider, authType, keyLabel);
          } finally {
            void props.reloadTiers();
          }
        }}
        onFallbacksUpdate={() => void props.reloadTiers()}
        persistFallbacks={(models: string[], routes?: ModelRoute[]) =>
          setFallbacks(props.agentName, TIER, models, routes)
        }
        persistClearFallbacks={() => clearFallbacks(props.agentName, TIER)}
        persistClearChain={async () => {
          // A tier reset clears only the primary; drop the fallbacks first.
          await clearFallbacks(props.agentName, TIER);
          await resetTier(props.agentName, TIER);
        }}
        paramsScope={modelParamsScopeForTier(TIER)}
        getModelParams={props.getModelParams}
        setModelParams={props.setModelParams}
      />
      {showExample ? (
        <VirtualModelSnippetModal
          agentName={props.agentName}
          virtualModel={{ name: 'auto', enabled: true }}
          onClose={() => setShowExample(false)}
        />
      ) : null}
    </>
  );
}
