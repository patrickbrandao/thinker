import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Pencil, Settings, Undo2 } from 'lucide-react';
import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  ModelRoute,
  RequestParamDefaults,
  ResponseMode,
  RoutingProvider,
} from '../services/api.js';
import { providerIcon, customProviderLogo } from './ProviderIcon.js';
import { authBadgeFor } from './AuthBadge.js';
import {
  resolveProviderId,
  inferProviderFromModel,
  pricePerM,
  usedKeyLabelsForModelInTier,
  activeRouteKeys,
  routeKeySelectionForModel,
} from '../services/routing-utils.js';
import { customProviderColor, formatPerRequestCost } from '../services/formatters.js';
import { PROVIDERS } from '../services/providers.js';
import FallbackList from './FallbackList.js';
import ModelParamsAffordance from './ModelParamsAffordance.jsx';
import ModelPickerModal from './ModelPickerModal.js';
import RouteKeyChip from './RouteKeyChip.js';
import KeyPickerModal from './KeyPickerModal.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { Button, cx, useClickOutside } from './ui.js';

function providerIdForModel(model: string, apiModels: AvailableModel[]): string | undefined {
  const m =
    apiModels.find((x) => x.model_name === model) ??
    apiModels.find((x) => x.model_name.startsWith(model + '-'));
  if (m) {
    const dbId = resolveProviderId(m.provider);
    if (dbId && dbId !== 'openrouter' && PROVIDERS.find((p) => p.id === dbId)) return dbId;
    const prefixId = inferProviderFromModel(m.model_name);
    if (prefixId && PROVIDERS.find((p) => p.id === prefixId)) return prefixId;
    return dbId ?? prefixId;
  }
  const prefix = inferProviderFromModel(model);
  if (prefix && PROVIDERS.find((p) => p.id === prefix)) return prefix;
  return undefined;
}

function providerDisplayName(providerId: string, customProviders: CustomProviderData[]): string {
  if (providerId.startsWith('custom:')) {
    const id = providerId.slice('custom:'.length);
    const cp = customProviders.find((p) => p.id === id);
    if (cp) return cp.name;
  }
  return PROVIDERS.find((p) => p.id === providerId)?.name ?? providerId;
}

/**
 * A named chain of concrete routes: a primary (`override_route`) and up to 5
 * fallbacks. Header tiers and virtual models (ADR 0004) share this shape and
 * this card; each wrapper adds its own header details and menu.
 */
export interface RouteChain {
  id: string;
  name: string;
  override_route: ModelRoute | null;
  fallback_routes: ModelRoute[] | null;
  response_mode?: ResponseMode;
}

export interface RouteChainCardProps {
  agentName: string;
  chain: RouteChain;
  /** Modifier class on the card root, e.g. `routing-card--header-tier`. */
  cardClass: string;
  /** Extra classes toggled on the card root. */
  classList?: Record<string, boolean>;
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
  /** Clears the primary (and the fallbacks behind it). */
  onResetChain: () => Promise<unknown>;
  persistFallbacks: (models: string[], routes?: ModelRoute[]) => Promise<unknown>;
  persistClearFallbacks: () => Promise<unknown>;
  /** Model params scope for every route of the chain (`header:<id>`, `virtual:<id>`). */
  paramsScope: string;
  /** Items of the options menu. `close` hides the menu. */
  renderMenu: (close: () => void) => ReactNode;
  /** Rendered next to the name, inside the title. */
  titleExtra?: ReactNode;
  /** Rendered before the name, e.g. a drag handle. */
  titleLeading?: ReactNode;
  /** Rendered under the header, before the primary chip. */
  details?: ReactNode;
  /**
   * Per-route params getter, threaded from the routing page boundary. When
   * present, the primary chip and every fallback row render a
   * `<ModelParamsAffordance>` for their own `(provider, authType, model)`
   * tuple. Closes the gap where the custom (header-tier) routing surface
   * had no params support at all.
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

type PickerMode = 'primary' | 'fallback' | null;
interface PendingKeyPick {
  mode: Exclude<PickerMode, null>;
  model: string;
  provider: string;
  authType?: AuthType;
  keys: RoutingProvider[];
}

export default function RouteChainCard(props: RouteChainCardProps) {
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [pendingKeyPick, setPendingKeyPick] = useState<PendingKeyPick | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, menuOpen, closeMenu);

  const currentModel: string | null = props.chain.override_route?.model ?? null;
  const fallbacks: string[] = props.chain.fallback_routes?.map((r) => r.model) ?? [];

  const providerId: string | undefined = !currentModel
    ? undefined
    : props.chain.override_route?.provider
      ? props.chain.override_route.provider.toLowerCase()
      : providerIdForModel(currentModel, props.models);

  const modelInfo: AvailableModel | undefined = currentModel
    ? (props.models.find((x) => x.model_name === currentModel) ??
      props.models.find((x) => x.model_name.startsWith(currentModel + '-')))
    : undefined;

  const modelLabel = modelInfo?.display_name ?? currentModel ?? '';
  const isStreamMode = props.chain.response_mode === 'stream';
  const primarySkipped = isStreamMode && !(modelInfo?.capabilities?.includes('stream') ?? false);

  const priceLabel = modelInfo
    ? t('routing.pricePerM', {
        input: pricePerM(modelInfo.input_price_per_token),
        output: pricePerM(modelInfo.output_price_per_token),
      })
    : '';

  const effectiveAuth: AuthType | null = (() => {
    if (props.chain.override_route?.authType) return props.chain.override_route.authType;
    const id = providerId;
    if (!id) return null;
    const provs = props.connectedProviders.filter(
      (p) => p.provider.toLowerCase() === id.toLowerCase(),
    );
    // Precedence subscription > api_key > local. Keep the "you already pay a
    // sub" signal on top so a user with both a subscription and a local
    // Ollama connection sees the subscription badge first; local is the
    // weakest signal and only wins when it's the sole connection.
    if (provs.some((p) => p.auth_type === 'subscription')) return 'subscription';
    if (provs.some((p) => p.auth_type === 'api_key')) return 'api_key';
    if (provs.some((p) => p.auth_type === 'local')) return 'local';
    return null;
  })();

  const customProviderForId = (id: string | undefined): CustomProviderData | undefined => {
    if (!id?.startsWith('custom:')) return undefined;
    return props.customProviders.find((p) => `custom:${p.id}` === id);
  };

  const primaryKeys: RoutingProvider[] =
    !providerId || !effectiveAuth || effectiveAuth === 'local'
      ? []
      : activeRouteKeys(props.connectedProviders, providerId, effectiveAuth);

  const handlePrimaryKeyPick = async (label: string | null): Promise<void> => {
    const route = props.chain.override_route;
    const provider = providerId ?? route?.provider;
    const auth = effectiveAuth ?? route?.authType;
    if (!route || !provider || !auth) return;
    await props.onOverride(route.model, provider, auth, label ?? undefined);
  };

  const addFallbackRoute = async (
    model: string,
    provider: string,
    authType: AuthType | undefined,
    keyLabel?: string,
  ): Promise<void> => {
    const next = [...fallbacks, model];
    const currentRoutes = props.chain.fallback_routes ?? [];
    const auth = authType ?? 'api_key';
    const nextRoute: ModelRoute = keyLabel
      ? { provider, authType: auth, model, keyLabel }
      : { provider, authType: auth, model };
    const nextRoutes = [...currentRoutes, nextRoute];
    try {
      await props.persistFallbacks(next, nextRoutes);
      props.onFallbacksUpdate(next, nextRoutes);
      toast.success(t('routing.fallbackAdded'));
    } catch {
      toast.error(t('routing.fallbackAddFailed'));
    }
  };

  const completePickerSelection = async (
    mode: Exclude<PickerMode, null>,
    model: string,
    provider: string,
    authType?: AuthType,
    keyLabel?: string,
  ): Promise<void> => {
    if (mode === 'primary') {
      if (keyLabel === undefined) await props.onOverride(model, provider, authType);
      else await props.onOverride(model, provider, authType, keyLabel);
      return;
    }
    await addFallbackRoute(model, provider, authType, keyLabel);
  };

  const handlePickerSelect = async (
    _tierId: string,
    model: string,
    provider: string,
    authType?: AuthType,
  ): Promise<void> => {
    const mode = pickerMode;
    setPickerMode(null);
    if (!mode) return;
    const selection = routeKeySelectionForModel({
      providers: props.connectedProviders,
      tier: props.chain,
      modelName: model,
      providerId: provider,
      authType: authType ?? 'api_key',
      slot: mode,
    });
    if (selection.exhausted) return;
    if (selection.autoLabel) {
      await completePickerSelection(mode, model, provider, authType, selection.autoLabel);
      return;
    }
    if (!selection.needsChoice) {
      await completePickerSelection(mode, model, provider, authType);
      return;
    }
    setPendingKeyPick({ mode, model, provider, authType, keys: selection.keys });
  };

  const handlePendingKeyPick = (label: string | null): void => {
    const pending = pendingKeyPick;
    if (!pending) return;
    setPendingKeyPick(null);
    void completePickerSelection(
      pending.mode,
      pending.model,
      pending.provider,
      pending.authType,
      label ?? undefined,
    );
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await props.onResetChain();
      props.onFallbacksUpdate([]);
    } catch {
      // silent
    } finally {
      setResetting(false);
    }
  };

  const renderOverrideIcon = () => {
    if (providerId?.startsWith('custom:')) {
      const cp = customProviderForId(providerId);
      const logo = cp ? customProviderLogo(cp.name, 14) : null;
      return (
        <span
          className="routing-card__override-icon inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-on-accent"
          style={{ backgroundColor: customProviderColor(providerId.slice('custom:'.length)) }}
        >
          {logo ?? (cp?.name ?? 'C').charAt(0).toUpperCase()}
        </span>
      );
    }
    if (!providerId) return null;
    return (
      <span className="routing-card__override-icon relative inline-flex shrink-0">
        {providerIcon(providerId, 14)}
        {authBadgeFor(effectiveAuth, 8)}
      </span>
    );
  };

  const skippedBadge = primarySkipped ? (
    <span className="routing-card__skipped-badge badge is-warn">
      {t('routing.skippedInStream')}
    </span>
  ) : null;

  const rootClasses = Object.entries(props.classList ?? {})
    .filter(([, on]) => on)
    .map(([name]) => name);

  return (
    <div
      className={cx('routing-card card flex flex-col gap-3 p-3', props.cardClass, ...rootClasses)}
    >
      <div className="routing-card__header flex min-h-7 items-center justify-between gap-2">
        <span className="routing-card__tier header-tier-card__title flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
          {props.titleLeading}
          <span className="header-tier-card__name truncate">{props.chain.name}</span>
          {props.titleExtra}
          <div ref={menuRef} className="header-tier-card__kebab relative">
            <button
              type="button"
              className="header-tier-card__icon-btn icon-btn size-6"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={t('routing.chain.optionsFor', { name: props.chain.name })}
              aria-expanded={menuOpen}
              title={t('routing.chain.options')}
            >
              <Settings aria-hidden="true" className="size-3.5" />
            </button>
            {menuOpen ? (
              <div className="header-tier-card__menu menu left-0 top-full mt-1 font-normal">
                {props.renderMenu(closeMenu)}
              </div>
            ) : null}
          </div>
        </span>
        {currentModel ? (
          <Button
            variant="quiet"
            size="sm"
            className="routing-card__header-action routing-card__header-action--danger"
            onClick={handleReset}
            disabled={resetting}
          >
            {resetting ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Undo2 aria-hidden="true" className="size-3" />
            )}
            {t('routing.reset')}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="routing-card__header-add"
            onClick={() => setPickerMode('primary')}
          >
            {t('routing.addModel')}
          </Button>
        )}
      </div>

      {props.details}

      <div className="routing-card__body">
        {currentModel ? (
          <div
            className={cx(
              'routing-card__model-chip cursor-pointer rounded-control border border-line bg-sunken p-2.5 transition-colors hover:border-line-strong',
              primarySkipped && 'routing-card__model-chip--skipped opacity-60',
            )}
            title={primarySkipped ? t('routing.skippedWhileStream') : undefined}
            onClick={() => setPickerMode('primary')}
          >
            <div className="routing-card__chip-main flex items-center justify-between gap-2">
              <div className="routing-card__override flex min-w-0 items-center gap-1.5">
                {renderOverrideIcon()}
                <span className="routing-card__main truncate text-sm font-medium text-ink">
                  {modelLabel || currentModel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {primaryKeys.length > 1 ? (
                  <RouteKeyChip
                    keys={primaryKeys}
                    currentLabel={props.chain.override_route?.keyLabel ?? undefined}
                    modelLabel={modelLabel || currentModel}
                    usedLabels={usedKeyLabelsForModelInTier(
                      props.chain,
                      currentModel,
                      'primary',
                      primaryKeys[0]?.label,
                    )}
                    buttonClass="routing-card__key-chip"
                    leadingMargin
                    stopPropagation
                    onPick={handlePrimaryKeyPick}
                  />
                ) : null}
                {props.getModelParams &&
                props.setModelParams &&
                providerId &&
                effectiveAuth &&
                effectiveAuth !== 'local' ? (
                  <ModelParamsAffordance
                    provider={providerId}
                    authType={effectiveAuth}
                    model={currentModel}
                    slotLabel={modelLabel || currentModel}
                    scope={props.paramsScope}
                    agentName={props.agentName}
                    getParams={props.getModelParams}
                    setParams={props.setModelParams}
                  />
                ) : null}
                <button
                  type="button"
                  className="routing-card__chip-action icon-btn size-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPickerMode('primary');
                  }}
                  aria-label={t('routing.changeModelFor', { name: props.chain.name })}
                  title={t('routing.change')}
                >
                  <Pencil aria-hidden="true" className="size-3" />
                </button>
              </div>
            </div>
            <div className="routing-card__chip-footer mt-1.5">
              <span className="routing-card__chip-meta flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span className="routing-card__chip-price">
                  {effectiveAuth === 'subscription'
                    ? (formatPerRequestCost(modelInfo?.cost_per_request) ??
                      t('routing.includedInSubscription'))
                    : priceLabel}
                </span>
                {skippedBadge}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {currentModel ? (
        <div className="routing-card__right">
          <FallbackList
            agentName={props.agentName}
            tier={props.chain.id}
            fallbacks={fallbacks}
            fallbackRoutes={props.chain.fallback_routes ?? null}
            tierData={props.chain}
            models={props.models}
            customProviders={props.customProviders}
            connectedProviders={props.connectedProviders}
            onUpdate={(updated, updatedRoutes) => props.onFallbacksUpdate(updated, updatedRoutes)}
            onAddFallback={() => setPickerMode('fallback')}
            persistFallbacks={(_agent, _id, models, routes) =>
              props.persistFallbacks(models, routes)
            }
            getModelParams={props.getModelParams}
            setModelParams={props.setModelParams}
            modelParamsScope={props.paramsScope}
            responseMode={props.chain.response_mode ?? 'buffered'}
            persistClearFallbacks={() => props.persistClearFallbacks()}
          />
        </div>
      ) : null}

      {pickerMode !== null ? (
        <ModelPickerModal
          tierId={props.chain.id}
          models={props.models}
          tiers={[]}
          customProviders={props.customProviders}
          connectedProviders={props.connectedProviders}
          requiredCapability={props.chain.response_mode === 'stream' ? 'stream' : undefined}
          onClose={() => setPickerMode(null)}
          onSelect={handlePickerSelect}
        />
      ) : null}

      {pendingKeyPick ? (
        <KeyPickerModal
          providerName={providerDisplayName(pendingKeyPick.provider, props.customProviders)}
          modelName={pendingKeyPick.model}
          keys={pendingKeyPick.keys}
          onPick={handlePendingKeyPick}
          onClose={() => setPendingKeyPick(null)}
        />
      ) : null}
    </div>
  );
}
