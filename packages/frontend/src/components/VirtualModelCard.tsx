import type { ReactNode } from 'react';
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
  clearVirtualModelFallbacks,
  clearVirtualModelOverride,
  setVirtualModelFallbacks,
  type VirtualModel,
} from '../services/api/virtual-models.js';
import RouteChainCard from './RouteChainCard.js';
import VirtualModelShadowWarning from './VirtualModelShadowWarning.js';
import { modelParamsScopeForVirtualModel } from 'thinker-shared';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

interface SwitchProps {
  label: string;
  on: boolean;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
}

/** Labelled switch; `routing-switch*` classes are stable hooks, the look is `.switch`. */
function CardSwitch(props: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      className={cx(
        'routing-switch virtual-model-card__switch inline-flex items-center gap-2 text-xs text-dim disabled:cursor-not-allowed disabled:opacity-60',
        props.on && 'routing-switch--on',
      )}
      disabled={props.disabled || props.busy}
      title={props.title}
      onClick={() => props.onToggle()}
    >
      <span className="switch inline-block shrink-0" aria-hidden="true" aria-checked={props.on} />
      {props.busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span className="routing-switch__label">{props.label}</span>
    </button>
  );
}

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
  onToggle: (enabled: boolean) => void;
  onContinueOnDefaultChange: (value: boolean) => void;
  onResponseModeChange: (mode: ResponseMode) => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowExample: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Which setting is being saved, for the spinner on its switch. */
  busy?: 'enabled' | 'continue_on_default' | 'response_mode' | null;
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
 * 5 fallbacks) plus the virtual model's own switches, the copyable `model`
 * value and the shadowing warning.
 */
export default function VirtualModelCard(props: VirtualModelCardProps) {
  const vm = props.virtualModel;
  const isStream = vm.response_mode === 'stream';

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
      titleExtra={
        !vm.enabled ? (
          <span className="virtual-model-card__inactive badge">{t('models.vmCard.inactive')}</span>
        ) : null
      }
      details={
        <div className="virtual-model-card__details flex flex-col gap-2">
          <button
            type="button"
            className="virtual-model-card__model self-start truncate rounded-control bg-sunken px-2 py-0.5 font-mono text-xs text-ink hover:text-accent"
            title={t('models.vmCard.showExample')}
            onClick={() => props.onShowExample()}
          >
            {/* i18n-ignore */}
            model: &quot;{vm.name}&quot;
          </button>
          <div className="virtual-model-card__switches flex flex-wrap items-center gap-x-4 gap-y-2">
            <CardSwitch
              label={t('models.vmCard.active')}
              on={vm.enabled}
              busy={props.busy === 'enabled'}
              title={vm.enabled ? t('models.vmCard.hideTitle') : t('models.vmCard.listTitle')}
              onToggle={() => props.onToggle(!vm.enabled)}
            />
            <CardSwitch
              label={t('models.vmCard.continueOnDefault')}
              on={vm.continue_on_default}
              busy={props.busy === 'continue_on_default'}
              title={t('models.vmCard.continueTitle')}
              onToggle={() => props.onContinueOnDefaultChange(!vm.continue_on_default)}
            />
            <CardSwitch
              label={t('models.vmCard.stream')}
              on={isStream}
              busy={props.busy === 'response_mode'}
              title={
                isStream ? t('models.vmCard.streamOnTitle') : t('models.vmCard.streamOffTitle')
              }
              onToggle={() => props.onResponseModeChange(isStream ? 'buffered' : 'stream')}
            />
          </div>
          <VirtualModelShadowWarning shadows={vm.shadows ?? []} enabled={vm.enabled} />
        </div>
      }
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
