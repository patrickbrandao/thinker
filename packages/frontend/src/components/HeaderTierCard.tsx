import { useState } from 'react';
import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  ModelRoute,
  RequestParamDefaults,
  ResponseMode,
  RoutingProvider,
} from '../services/api.js';
import {
  type HeaderTier,
  resetHeaderTier,
  setHeaderTierFallbacks,
  clearHeaderTierFallbacks,
} from '../services/api/header-tiers.js';
import RouteChainCard from './RouteChainCard.js';
import HeaderTierSnippetModal from './HeaderTierSnippetModal.js';
import { modelParamsScopeForHeaderTier } from 'thinker-shared';
import { t } from '../i18n/index.js';

interface Props {
  agentName: string;
  tier: HeaderTier;
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  connectedProviders: RoutingProvider[];
  onOverride: (
    model: string,
    provider: string,
    authType?: AuthType,
    providerKeyLabel?: string,
  ) => void | Promise<void>;
  onFallbacksUpdate: (fallbacks: string[], routes?: ModelRoute[] | null) => void;
  onEdit?: () => void;
  onDisable?: () => void;
  changingResponseMode?: boolean;
  onResponseModeChange?: (mode: ResponseMode) => void | Promise<void>;
  /**
   * Per-route params getter, threaded from the routing page boundary. When
   * present, the primary chip and every fallback row render a
   * `<ModelParamsAffordance>` for their own `(provider, authType, model)`
   * tuple.
   */
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

/** A custom (header) tier: the shared route-chain card plus its header rule. */
export default function HeaderTierCard(props: Props) {
  const [snippetOpen, setSnippetOpen] = useState(false);
  const menuItemClass = 'header-tier-card__menu-item menu-item';

  return (
    <>
      <RouteChainCard
        agentName={props.agentName}
        chain={props.tier}
        cardClass="routing-card--header-tier"
        models={props.models}
        customProviders={props.customProviders}
        connectedProviders={props.connectedProviders}
        onOverride={props.onOverride}
        onFallbacksUpdate={props.onFallbacksUpdate}
        onResetChain={() => resetHeaderTier(props.agentName, props.tier.id)}
        persistFallbacks={(models, routes) =>
          setHeaderTierFallbacks(props.agentName, props.tier.id, models, routes)
        }
        persistClearFallbacks={() => clearHeaderTierFallbacks(props.agentName, props.tier.id)}
        paramsScope={modelParamsScopeForHeaderTier(props.tier.id)}
        getModelParams={props.getModelParams}
        setModelParams={props.setModelParams}
        details={
          <code
            className="header-tier-card__rule block truncate font-mono text-xs text-muted"
            title={`${props.tier.header_key}: ${props.tier.header_value}`}
          >
            {props.tier.header_key}: {props.tier.header_value}
          </code>
        }
        renderMenu={(close) => (
          <>
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                close();
                setSnippetOpen(true);
              }}
            >
              {t('routing.headerTierCard.sendHeader')}
            </button>
            {props.onEdit ? (
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  close();
                  props.onEdit?.();
                }}
              >
                {t('routing.headerTierCard.editTier')}
              </button>
            ) : null}
            {props.onDisable ? (
              <button
                type="button"
                className={`${menuItemClass} header-tier-card__menu-item--danger is-danger`}
                onClick={() => {
                  close();
                  props.onDisable?.();
                }}
              >
                {t('common.disable')}
              </button>
            ) : null}
          </>
        )}
      />

      {snippetOpen ? (
        <HeaderTierSnippetModal
          agentName={props.agentName}
          tier={props.tier}
          customProviders={props.customProviders}
          onClose={() => setSnippetOpen(false)}
        />
      ) : null}
    </>
  );
}
