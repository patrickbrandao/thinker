import type { ReactNode } from 'react';
import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  ModelRoute,
  RequestParamDefaults,
  RoutingProvider,
} from '../services/api.js';
import {
  clearVirtualModelFallbacks,
  clearVirtualModelOverride,
  setVirtualModelFallbacks,
  type VirtualModel,
} from '../services/api/virtual-models.js';
import RouteChainCard from './RouteChainCard.js';
import VirtualModelShadowWarning from './VirtualModelShadowWarning.js';
import VirtualModelTitle from './VirtualModelTitle.js';
import { modelParamsScopeForVirtualModel } from 'thinker-shared';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

export interface VirtualModelCardProps {
  agentName: string;
  virtualModel: VirtualModel;
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
  onEdit: () => void;
  onDelete: () => void;
  onShowExample: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Drag handle rendered before the name, supplied by the section. */
  dragHandle?: ReactNode;
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
 * A virtual model (ADR 0004): the shared route-chain card (primary and up to
 * 5 fallbacks) titled "Virtual model: <name>", with the shadowing warning.
 * The switches live in the edit modal.
 */
export default function VirtualModelCard(props: VirtualModelCardProps) {
  const vm = props.virtualModel;

  return (
    <RouteChainCard
      agentName={props.agentName}
      chain={vm}
      cardClass="routing-card--virtual-model"
      classList={{ 'routing-card--virtual-model-inactive': !vm.enabled }}
      models={props.models}
      customProviders={props.customProviders}
      connectedProviders={props.connectedProviders}
      onOverride={props.onOverride}
      onFallbacksUpdate={props.onFallbacksUpdate}
      onResetChain={() => clearVirtualModelOverride(props.agentName, vm.id)}
      persistFallbacks={(models, routes) =>
        setVirtualModelFallbacks(props.agentName, vm.id, models, routes)
      }
      persistClearFallbacks={() => clearVirtualModelFallbacks(props.agentName, vm.id)}
      paramsScope={modelParamsScopeForVirtualModel(vm.id)}
      getModelParams={props.getModelParams}
      setModelParams={props.setModelParams}
      titleLeading={props.dragHandle}
      titleContent={<VirtualModelTitle name={vm.name} onShowExample={props.onShowExample} />}
      titleExtra={
        !vm.enabled ? (
          <span className="virtual-model-card__inactive badge">{t('models.vmCard.inactive')}</span>
        ) : null
      }
      details={<VirtualModelShadowWarning shadows={vm.shadows ?? []} enabled={vm.enabled} />}
      renderMenu={(close) => {
        const item = (label: string, action: () => void, danger = false) => (
          <button
            type="button"
            className={cx(
              'header-tier-card__menu-item menu-item',
              danger && 'header-tier-card__menu-item--danger is-danger',
            )}
            onClick={() => {
              close();
              action();
            }}
          >
            {label}
          </button>
        );
        return (
          <>
            {item(t('models.vmCard.copyExample'), props.onShowExample)}
            {item(t('models.vmCard.edit'), props.onEdit)}
            {props.onMoveUp ? item(t('models.vmCard.moveUp'), () => props.onMoveUp?.()) : null}
            {props.onMoveDown
              ? item(t('models.vmCard.moveDown'), () => props.onMoveDown?.())
              : null}
            {item(t('models.vmCard.delete'), props.onDelete, true)}
          </>
        );
      }}
    />
  );
}
