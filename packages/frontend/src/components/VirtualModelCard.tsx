import { Show, type Component, type JSX } from 'solid-js';
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

interface SwitchProps {
  label: string;
  on: boolean;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
}

const CardSwitch: Component<SwitchProps> = (props) => (
  <button
    type="button"
    role="switch"
    aria-checked={props.on}
    class="routing-switch virtual-model-card__switch"
    classList={{ 'routing-switch--on': props.on }}
    disabled={props.disabled || props.busy}
    title={props.title}
    onClick={() => props.onToggle()}
  >
    <span class="routing-switch__track">
      <span class="routing-switch__thumb">
        <Show when={props.busy}>
          <span class="spinner virtual-model-card__switch-spinner" />
        </Show>
      </span>
    </span>
    <span class="routing-switch__label">{props.label}</span>
  </button>
);

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
  dragHandle?: JSX.Element;
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
const VirtualModelCard: Component<VirtualModelCardProps> = (props) => {
  const vm = () => props.virtualModel;
  const isStream = () => vm().response_mode === 'stream';

  return (
    <RouteChainCard
      agentName={props.agentName}
      chain={vm()}
      cardClass="routing-card--virtual-model"
      classList={{ 'routing-card--virtual-model-inactive': !vm().enabled }}
      models={props.models}
      customProviders={props.customProviders}
      connectedProviders={props.connectedProviders}
      onOverride={props.onOverride}
      onFallbacksUpdate={props.onFallbacksUpdate}
      onResetChain={() => clearVirtualModelOverride(props.agentName, vm().id)}
      persistFallbacks={(models, routes) =>
        setVirtualModelFallbacks(props.agentName, vm().id, models, routes)
      }
      persistClearFallbacks={() => clearVirtualModelFallbacks(props.agentName, vm().id)}
      paramsScope={modelParamsScopeForVirtualModel(vm().id)}
      getModelParams={props.getModelParams}
      setModelParams={props.setModelParams}
      titleLeading={props.dragHandle}
      titleExtra={
        <Show when={!vm().enabled}>
          <span class="virtual-model-card__inactive">Inactive</span>
        </Show>
      }
      details={
        <div class="virtual-model-card__details">
          <button
            type="button"
            class="virtual-model-card__model"
            title="Show a copyable example"
            onClick={() => props.onShowExample()}
          >
            model: "{vm().name}"
          </button>
          <div class="virtual-model-card__switches">
            <CardSwitch
              label="Active"
              on={vm().enabled}
              busy={props.busy === 'enabled'}
              title={
                vm().enabled
                  ? 'Hide from /v1/models and stop matching requests'
                  : 'List in /v1/models and match requests'
              }
              onToggle={() => props.onToggle(!vm().enabled)}
            />
            <CardSwitch
              label="Continue on Default"
              on={vm().continue_on_default}
              busy={props.busy === 'continue_on_default'}
              title="When the chain runs out, continue with the Default tier's chain"
              onToggle={() => props.onContinueOnDefaultChange(!vm().continue_on_default)}
            />
            <CardSwitch
              label="Stream"
              on={isStream()}
              busy={props.busy === 'response_mode'}
              title={
                isStream()
                  ? 'Responses are streamed token by token'
                  : 'Responses are returned as a single payload'
              }
              onToggle={() => props.onResponseModeChange(isStream() ? 'buffered' : 'stream')}
            />
          </div>
          <VirtualModelShadowWarning shadows={vm().shadows ?? []} enabled={vm().enabled} />
        </div>
      }
      renderMenu={(close) => {
        const item = (label: string, action: () => void, danger = false) => (
          <button
            type="button"
            class="header-tier-card__menu-item"
            classList={{ 'header-tier-card__menu-item--danger': danger }}
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
            {item('Copy example', props.onShowExample)}
            {item('Edit virtual model', props.onEdit)}
            <Show when={props.onMoveUp}>{item('Move up', () => props.onMoveUp?.())}</Show>
            <Show when={props.onMoveDown}>{item('Move down', () => props.onMoveDown?.())}</Show>
            {item('Delete', props.onDelete, true)}
          </>
        );
      }}
    />
  );
};

export default VirtualModelCard;
